// Public comps for the deal desk's Benchmarking page, from Kensho (S&P Global data).
// Any signed-in login (CEO or Corp Dev) may call it. Kensho credentials stay here as Supabase secrets;
// results are computed on request and kept in memory for 10 minutes, never written to the database.
//
// Secrets (supabase secrets set ...), either:
//   KENSHO_REFRESH_TOKEN                         a kfinance refresh token
// or a key pair registered with Kensho:
//   KENSHO_CLIENT_ID, KENSHO_PRIVATE_KEY (PKCS#8 PEM), optional KENSHO_KEY_ID
// Optional: ALLOWED_ORIGIN (the site's address, as for the claude function).
//
// POST /functions/v1/comps  {"tickers": ["WRB", "LSE:HSX", ...], "period": "quarter" | "ytd" | "ltm"}  ->  {asOf, period, companies, medians, errors}

import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { cleanTickers, computeCompany, medians, PERIOD_TYPE, type CompanyIn, type Earnings, type MarketCaps, type PeriodKind, type StatementsResult } from "./core.ts";
import { Kensho, KenshoError } from "./kensho.ts";

type Env = (k: string) => string | undefined;
type Deps = { env: Env; fetch: typeof fetch; now?: () => number; whoIs?: (req: Request) => Promise<string | null> };

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();
let client: { key: string; f: typeof fetch; k: Kensho } | null = null;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const cors = {
    "Access-Control-Allow-Origin": allowOrigin(deps.env("ALLOWED_ORIGIN"), req.headers.get("Origin")),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  // Any unexpected failure still answers with CORS headers, so the page can show the reason
  // instead of the browser's bare "Failed to fetch".
  try { return await serve(req, deps, json); }
  catch (e) { return json(500, { error: "server", message: `The comps function failed: ${(e as Error)?.message || "unknown error"}` }); }
}

/** ALLOWED_ORIGIN may be a site address with a path or trailing slash, or several separated by commas:
    compare origins only, and echo the caller's origin when it is one of them. */
export function allowOrigin(setting: string | undefined, origin: string | null): string {
  if (!setting || !setting.trim() || setting.trim() === "*") return "*";
  const allowed = setting.split(",").map((s) => { try { return new URL(s.trim()).origin; } catch { return s.trim().replace(/\/+$/, ""); } }).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : allowed[0];
}

async function serve(req: Request, deps: Deps, json: (status: number, body: unknown) => Response): Promise<Response> {
  const role = await (deps.whoIs ?? whoIs(deps.env))(req);
  if (!role) return json(401, { error: "Sign in again." });

  const creds = { refreshToken: deps.env("KENSHO_REFRESH_TOKEN"), clientId: deps.env("KENSHO_CLIENT_ID"), privateKey: deps.env("KENSHO_PRIVATE_KEY")?.replace(/\\n/g, "\n"), keyId: deps.env("KENSHO_KEY_ID") };
  if (!Kensho.configured(creds)) return json(503, { error: "not_configured", message: "Kensho isn't connected yet. Set KENSHO_REFRESH_TOKEN (or KENSHO_CLIENT_ID and KENSHO_PRIVATE_KEY) on the comps function." });

  let tickers: string[] | null = null, period: PeriodKind = "quarter";
  try { const body = await req.json(); tickers = cleanTickers(body.tickers); if (body.period !== undefined) period = body.period; } catch { /* fall through */ }
  if (!tickers) return json(400, { error: "Send 1 to 25 tickers, like WRB or LSE:HSX." });
  if (!(period in PERIOD_TYPE)) return json(400, { error: 'period must be "quarter", "ytd" or "ltm".' });

  const now = (deps.now ?? Date.now)();
  const key = period + "|" + [...tickers].sort().join(",");
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return json(200, hit.body);

  const ckey = JSON.stringify(creds);
  if (!client || client.key !== ckey || client.f !== deps.fetch) client = { key: ckey, f: deps.fetch, k: new Kensho(creds, deps.fetch, deps.now ?? Date.now) };
  const k = client.k;
  try {
    // 1. tickers -> company ids
    const ids = await k.call<{ data: Record<string, { company_id?: number; error?: string; company_name?: string; name?: string }> }>("ids", { identifiers: tickers });
    const errors: Record<string, string> = {};
    const found: { ticker: string; companyId: number; name: string }[] = [];
    for (const t of tickers) {
      const r = ids.data?.[t] ?? ids.data?.[t.toLowerCase()];
      if (r?.company_id) found.push({ ticker: t, companyId: r.company_id, name: r.company_name ?? r.name ?? t });
      else errors[t] = r?.error ?? "Not found in Kensho";
    }
    const cids = found.map((f) => f.companyId);
    if (!cids.length) return json(200, { asOf: new Date(now).toISOString(), period, companies: [], medians: {}, errors });

    // 2. statements for everyone at once: five periods of income in the chosen series (latest, year-ago, and
    //    what's needed for twelve-month net income), one balance sheet
    type Post = { results: Record<string, StatementsResult>; errors?: Record<string, string> };
    const [inc, bal] = await Promise.all([
      k.call<Post>("statements/", { company_ids: cids, statement_type: "income_statement", period_type: PERIOD_TYPE[period], num_periods: 5 }),
      k.call<Post>("statements/", { company_ids: cids, statement_type: "balance_sheet", period_type: "quarterly", num_periods: 5 }),
    ]);
    // 3. market cap and shares outstanding (from ten days before the year-ago balance sheet to today, so the
    //    latest market cap and the share counts for book value per share come in one call) and earnings calls
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const per = await Promise.all(found.map(async (f) => {
      const ends = Object.values(bal.results?.[String(f.companyId)]?.periods ?? {}).map((p) => Date.parse(p.period_end_date)).filter((t) => isFinite(t));
      const oldest = Math.max(Math.min(now, ...ends.filter((t) => now - t < 500 * 86_400_000)), now - 500 * 86_400_000);
      const [mc, ea] = await Promise.all([
        k.call<MarketCaps>(`market_cap/${f.companyId}/${day(oldest - 10 * 86_400_000)}/${day(now)}`).catch(() => null),
        k.call<Earnings>(`earnings/${f.companyId}`).catch(() => null),
      ]);
      return { mc, ea };
    }));

    const companies = found.map((f, i) => {
      const c: CompanyIn = { ticker: f.ticker, name: f.name, companyId: f.companyId,
        income: inc.results?.[String(f.companyId)] ?? null, balance: bal.results?.[String(f.companyId)] ?? null,
        marketCap: per[i].mc, earnings: per[i].ea };
      if (!c.income) errors[f.ticker] = inc.errors?.[String(f.companyId)] ?? "No quarterly statements";
      return computeCompany(c, now, period);
    }).filter((c) => !errors[c.ticker] || c.quarter !== "n/d");

    const body = { asOf: new Date(now).toISOString(), period, companies, medians: medians(companies), errors, source: "S&P Global Capital IQ via Kensho" };
    cache.set(key, { at: now, body });
    return json(200, body);
  } catch (e) {
    const err = e as KenshoError;
    if (err.auth) return json(502, { error: "kensho_auth", message: `${err.message}. Check the Kensho credentials on the comps function.` });
    return json(502, { error: "kensho", message: err.message || "Kensho didn't answer. Try again in a minute." });
  }
}

/** The caller's role, using their own token so row-level security applies. */
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
if (!(globalThis as { __COMPS_TEST__?: boolean }).__COMPS_TEST__) {
  Deno.serve((req) => handle(req, { env: (k) => Deno.env.get(k), fetch }));
}
