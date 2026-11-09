// League table for the Banker CRM, from S&P Global M&A data via Kensho. Any signed-in login may call it.
// Kensho has no market-wide league table, so this one covers the deals of companies we choose: for each company,
// its M&A transactions (as buyer, seller or target) started in the last N years, then each deal's participants and
// their advisors. The page ranks the advisors. Uses the same Kensho secrets as the comps function (Supabase secrets
// apply to every function). Each fetch is saved to public.kensho_store (migration 0007, row "league:<years>") so the
// page opens from the last fetch and only asks Kensho again on Refresh; results are also kept in memory for 6 hours.
//
// POST /functions/v1/league  {"companies": ["WRB", "LSE:HSX", ...], "years": 3, "refresh": true}
//   -> {asOf, since, years, tickers, companies: [{ticker, name, deals}], deals: [...], errors, dropped, source, saved}

import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { resolveIds } from "../comps/fetch.ts";
import { Kensho, KenshoError } from "../comps/kensho.ts";
import { makeStore, type Store } from "../comps/store.ts";
import { cleanCompanies, cleanYears, MAX_COMPANIES, pickDeals, sinceDate, toDeal, type Deal, type MergerInfo, type MergersResp } from "./core.ts";

type Env = (k: string) => string | undefined;
type Deps = { env: Env; fetch: typeof fetch; now?: () => number; whoIs?: (req: Request) => Promise<string | null>; store?: Store };

const CACHE_MS = 6 * 3600_000;
const INFO_BATCH = 25, PARALLEL = 4;
const cache = new Map<string, { at: number; body: unknown }>();
let client: { key: string; f: typeof fetch; k: Kensho } | null = null;

export function allowOrigin(setting: string | undefined, origin: string | null): string {
  if (!setting || !setting.trim() || setting.trim() === "*") return "*";
  const allowed = setting.split(",").map((s) => { try { return new URL(s.trim()).origin; } catch { return s.trim().replace(/\/+$/, ""); } }).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : allowed[0];
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const cors = { "Access-Control-Allow-Origin": allowOrigin(deps.env("ALLOWED_ORIGIN"), req.headers.get("Origin")), "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  try { return await serve(req, deps, json); }
  catch (e) { return json(500, { error: "server", message: `The league function failed: ${(e as Error)?.message || "unknown error"}` }); }
}

/** Run fn over items, at most `n` at a time, keeping order. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } }));
  return out;
}

async function serve(req: Request, deps: Deps, json: (status: number, body: unknown) => Response): Promise<Response> {
  const role = await (deps.whoIs ?? whoIs(deps.env))(req);
  if (!role) return json(401, { error: "Sign in again." });

  const creds = { refreshToken: deps.env("KENSHO_REFRESH_TOKEN"), clientId: deps.env("KENSHO_CLIENT_ID"), privateKey: deps.env("KENSHO_PRIVATE_KEY")?.replace(/\\n/g, "\n"), keyId: deps.env("KENSHO_KEY_ID") };
  if (!Kensho.configured(creds)) return json(503, { error: "not_configured", message: "Kensho isn't connected yet. Set the Kensho secrets (README, section 7)." });

  let companies: string[] | null = null, years: number | null = 3, refresh = false;
  try { const body = await req.json(); companies = cleanCompanies(body.companies); years = cleanYears(body.years); refresh = body.refresh === true; } catch { /* fall through */ }
  if (!companies) return json(400, { error: `Send 1 to ${MAX_COMPANIES} tickers, like WRB or LSE:HSX.` });
  if (!years) return json(400, { error: "years must be a whole number from 1 to 5." });

  const now = (deps.now ?? Date.now)();
  const key = years + "|" + [...companies].sort().join(",");
  const hit = cache.get(key);
  if (!refresh && hit && now - hit.at < CACHE_MS) return json(200, hit.body);

  const ckey = JSON.stringify(creds);
  if (!client || client.key !== ckey || client.f !== deps.fetch) client = { key: ckey, f: deps.fetch, k: new Kensho(creds, deps.fetch, deps.now ?? Date.now) };
  const k = client.k;
  const since = sinceDate(now, years);
  try {
    const { found, errors } = await resolveIds(k, companies);
    const lists = await pool(found, PARALLEL, async (f) => {
      try { return { ticker: f.ticker, resp: await k.call<MergersResp>(`mergers/${f.companyId}/${since}/none`) }; }
      catch (e) { if ((e as KenshoError).auth) throw e; errors[f.ticker] = "Kensho had no M&A list for this company"; return { ticker: f.ticker, resp: null }; }
    });
    const { picked, dropped } = pickDeals(lists, since);
    const batches: (typeof picked)[] = [];
    for (let i = 0; i < picked.length; i += INFO_BATCH) batches.push(picked.slice(i, i + INFO_BATCH));
    let missing = 0;
    const infos = await pool(batches, PARALLEL, async (b) => {
      try { return (await k.call<{ results: Record<string, MergerInfo> }>("mergers/info", { transaction_ids: b.map(([id]) => Number(id)), include_advisors: true, include_comments: false })).results ?? {}; }
      catch (e) { if ((e as KenshoError).auth) throw e; missing += b.length; return {} as Record<string, MergerInfo>; }
    });
    const info: Record<string, MergerInfo> = Object.assign({}, ...infos);
    const deals: Deal[] = [];
    for (const [id, { s, via }] of picked) {
      const i = info[id];
      if (!i || i.error) continue;
      deals.push(toDeal(id, i, s, via));
    }
    if (missing) errors["(deal details)"] = `Kensho didn't return details for ${missing} deal${missing === 1 ? "" : "s"}; they're left out.`;
    const body = { asOf: new Date(now).toISOString(), since, years, tickers: companies,
      companies: found.map((f) => ({ ticker: f.ticker, name: f.name, deals: deals.filter((d) => d.via.includes(f.ticker)).length })),
      deals, errors, dropped, source: "S&P Global Capital IQ via Kensho" };
    cache.set(key, { at: now, body });
    const saved = found.length ? await (deps.store ?? makeStore(deps.env))(`league:${years}`, body) : false;
    return json(200, { ...body, saved });
  } catch (e) {
    const err = e as KenshoError;
    if (err.auth) return json(502, { error: "kensho_auth", message: `${err.message}. Check the Kensho secrets (README, section 7).` });
    return json(502, { error: "kensho", message: err.message || "Kensho didn't answer. Try again in a minute." });
  }
}

/** The caller's role, using their own token so row-level security applies. Any login (CEO or Corp Dev). */
function whoIs(env: Env) {
  return async (req: Request): Promise<string | null> => {
    const auth = req.headers.get("Authorization") ?? "", key = req.headers.get("apikey") || env("SUPABASE_ANON_KEY") || "";
    if (!auth || !key) return null;
    const sb = createClient(env("SUPABASE_URL")!, key, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data: profile } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return profile?.role ?? null;
  };
}

// Tests import handle() with this flag set; in Supabase the server always starts.
if (!(globalThis as { __LEAGUE_TEST__?: boolean }).__LEAGUE_TEST__) {
  Deno.serve((req) => handle(req, { env: (k) => Deno.env.get(k), fetch }));
}
