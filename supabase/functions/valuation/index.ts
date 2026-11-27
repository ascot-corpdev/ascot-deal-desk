// Valuation exhibits for the deal desk's Valuation tab, from S&P Global data via Kensho: the trading comparables
// table (market cap, P/BV, P/TBV, P/E on the prior and forward fiscal year, forward return on BV and TBV, debt to
// capital, combined ratios) and each company's daily P/TBV over up to ten years. Any signed-in login may call it.
// Uses the same Kensho secrets as the comps function. London-listed market caps are turned into US$ with ECB
// reference rates from Frankfurter (api.frankfurter.dev, no key; Kensho has no exchange rates).
// Ascot's own figures are never sent here: they're typed into the page and stay in the browser tab.
//
// Each fetch is saved to public.kensho_store (row "valuation:latest"; migration 0008 allows the name) so the page
// opens from the last fetch and only asks Kensho again on Refresh. Results are also kept in memory for 6 hours.
//
// POST /functions/v1/valuation  {"tickers": ["LSE:HSX", "ACGL", ...], "asOf": "2026-03-13" | "", "fy": 2026, "years": 10, "refresh": true}
//   -> {asOf, asOfAsked, fy, years, start, tickers, companies, history: {dates, series}, fx, errors, source, saved}

import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import type { MarketCaps, StatementsResult } from "../comps/core.ts";
import { resolveIds } from "../comps/fetch.ts";
import { Kensho, KenshoError } from "../comps/kensho.ts";
import { makeStore, type Store } from "../comps/store.ts";
import { alignSeries, BOOK_LAG_DAYS, booksOf, cleanValuationRequest, computeValuation, DAY, type Estimates, type Fx, fxCode, fxFromFrankfurter, fxRate, historyStart, ptbvSeries } from "./core.ts";

type Env = (k: string) => string | undefined;
type Deps = { env: Env; fetch: typeof fetch; now?: () => number; whoIs?: (req: Request) => Promise<string | null>; store?: Store };
type Post<T> = { results?: Record<string, T>; errors?: Record<string, string> };

const CACHE_MS = 6 * 3600_000, PARALLEL = 4;
const FX_HOSTS = ["https://api.frankfurter.dev/v1/", "https://api.frankfurter.app/"];
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
  catch (e) { return json(500, { error: "server", message: `The valuation function failed: ${(e as Error)?.message || "unknown error"}` }); }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } }));
  return out;
}

/** US$ rates for the currencies seen, from the history start to the as-at date. Empty if Frankfurter can't be reached. */
async function loadFx(f: typeof fetch, codes: string[], start: string, end: string): Promise<Fx> {
  if (!codes.length) return {};
  for (const host of FX_HOSTS) {
    try {
      const res = await f(`${host}${start}..${end}?base=USD&symbols=${codes.join(",")}`, { headers: { Accept: "application/json", "User-Agent": "ascot-deal-desk/1 (+supabase function valuation)" } });
      if (res.ok) return fxFromFrankfurter(await res.json());
    } catch { /* try the next host */ }
  }
  return {};
}

async function serve(req: Request, deps: Deps, json: (status: number, body: unknown) => Response): Promise<Response> {
  const role = await (deps.whoIs ?? whoIs(deps.env))(req);
  if (!role) return json(401, { error: "Sign in again." });

  const creds = { refreshToken: deps.env("KENSHO_REFRESH_TOKEN"), clientId: deps.env("KENSHO_CLIENT_ID"), privateKey: deps.env("KENSHO_PRIVATE_KEY")?.replace(/\\n/g, "\n"), keyId: deps.env("KENSHO_KEY_ID") };
  if (!Kensho.configured(creds)) return json(503, { error: "not_configured", message: "Kensho isn't connected yet. Set the Kensho secrets (README, section 7)." });

  const now = (deps.now ?? Date.now)();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* refused below */ }
  const r = cleanValuationRequest(body ?? {}, now);
  if (typeof r === "string") return json(400, { error: r });
  const refresh = body.refresh === true;

  const key = [r.asOf, r.fy, r.years, [...r.tickers].sort().join(",")].join("|");
  const hit = cache.get(key);
  if (!refresh && hit && now - hit.at < CACHE_MS) return json(200, hit.body);

  const ckey = JSON.stringify(creds);
  if (!client || client.key !== ckey || client.f !== deps.fetch) client = { key: ckey, f: deps.fetch, k: new Kensho(creds, deps.fetch, deps.now ?? Date.now) };
  const k = client.k;
  const start = historyStart(r.asOf, r.years), y0 = +start.slice(0, 4), y1 = +r.asOf.slice(0, 4);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  try {
    const { found, errors } = await resolveIds(k, r.tickers);
    const cids = found.map((f) => f.companyId);
    const notes: string[] = [];
    if (!cids.length) return json(200, { asOf: r.asOf, asOfAsked: r.asOfAsked, fy: r.fy, years: r.years, start, tickers: r.tickers, companies: [], history: { dates: [], series: {} }, fx: {}, errors, notes, source: "S&P Global Capital IQ via Kensho", saved: false });

    // balance sheets (quarterly and annual, so half-yearly London reporters are covered) back to the year before
    // the history starts; annual income statements for the combined ratios and the prior year's net income
    const stmt = (statement_type: string, period_type: string, start_year: number, end_year: number) =>
      k.call<Post<StatementsResult>>("statements/", { company_ids: cids, statement_type, period_type, start_year, end_year });
    const [balQ, balA, incA] = await Promise.all([
      stmt("balance_sheet", "quarterly", y0 - 1, y1), stmt("balance_sheet", "annual", y0 - 1, y1), stmt("income_statement", "annual", r.fy - 3, r.fy),
    ]);
    // consensus net income for the prior and forward fiscal years (needs Kensho's estimates permission)
    let est: Post<Estimates> = {};
    try {
      est = await k.call<Post<Estimates>>("estimates/", { company_ids: cids, line_item: "net_income_gaap", estimate_type: "consensus", period_type: "annual", fiscal_start_year: r.fy - 1, fiscal_end_year: r.fy });
    } catch (e) {
      if ((e as KenshoError).auth) throw e;
      notes.push(`Kensho didn't return consensus estimates (${(e as Error).message.slice(0, 120)}), so forward P/E and returns are blank.`);
    }
    // daily market caps from ten days before the history starts to the as-at date
    const caps = await pool(found, PARALLEL, async (f) => {
      try { return await k.call<MarketCaps>(`market_cap/${f.companyId}/${day(Date.parse(start) - 10 * DAY)}/${r.asOf}`); }
      catch (e) { if ((e as KenshoError).auth) throw e; errors[f.ticker] = "Kensho had no market caps for this company"; return null; }
    });

    const id = (cid: number) => String(cid);
    const ccys = new Set<string>();
    found.forEach((f, i) => {
      for (const c of [caps[i]?.currency, balQ.results?.[id(f.companyId)]?.currency, balA.results?.[id(f.companyId)]?.currency, incA.results?.[id(f.companyId)]?.currency]) if (c) ccys.add(fxCode(c));
      const e = est.results?.[id(f.companyId)];
      for (const p of Object.values(e?.periods ?? {})) {
        const list = Array.isArray(p.estimates) ? p.estimates : Object.values(p.estimates ?? {}).map((g) => ({ currency: g.currency }));
        for (const x of list) if (x.currency) ccys.add(fxCode(x.currency));
      }
    });
    ccys.delete("USD");
    const fx = await loadFx(deps.fetch, [...ccys].sort(), day(Date.parse(start) - 10 * DAY), r.asOf);
    const missingFx = [...ccys].filter((c) => !fx[c]?.length);
    if (missingFx.length) notes.push(`No exchange rates for ${missingFx.join(", ")}, so those companies' figures are blank.`);

    const recent = (now - Date.parse(r.asOf + "T00:00:00Z")) / DAY <= BOOK_LAG_DAYS;
    const companies = [], raw: Record<string, [string, number][]> = {};
    for (const [i, f] of found.entries()) {
      const c = { ticker: f.ticker, name: f.name, balQ: balQ.results?.[id(f.companyId)], balA: balA.results?.[id(f.companyId)], incA: incA.results?.[id(f.companyId)], caps: caps[i], est: est.results?.[id(f.companyId)] };
      if (!c.balQ && !c.balA) { errors[f.ticker] = balQ.errors?.[id(f.companyId)] ?? "No balance sheets"; continue; }
      companies.push(computeValuation(c, r.asOf, r.fy, fx, recent));
      raw[f.ticker] = ptbvSeries(caps[i], booksOf([c.balQ, c.balA]), start, r.asOf, fx);
    }
    const out = { asOf: r.asOf, asOfAsked: r.asOfAsked, fy: r.fy, years: r.years, start, tickers: r.tickers, companies, history: alignSeries(raw),
      fx: Object.fromEntries([...ccys].map((c) => [c, fxRate(fx, c, r.asOf)])), errors, notes, source: "S&P Global Capital IQ via Kensho; exchange rates: ECB via Frankfurter" };
    cache.set(key, { at: now, body: out });
    const saved = companies.length ? await (deps.store ?? makeStore(deps.env))("valuation:latest", out) : false;
    return json(200, { ...out, saved });
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
if (!(globalThis as { __VALUATION_TEST__?: boolean }).__VALUATION_TEST__) {
  Deno.serve((req) => handle(req, { env: (k) => Deno.env.get(k), fetch }));
}
