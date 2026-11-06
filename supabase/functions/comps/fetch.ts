// Kensho requests shared by the comps function (the Comps table) and the comps-chat function (Claude on the
// Comps tab). Network only: the arithmetic is in core.ts.
import { computeCompany, medians, PERIOD_TYPE, type CompanyIn, type CompanyOut, type Earnings, type MarketCaps, type PeriodKind, type StatementsResult } from "./core.ts";
import type { Kensho } from "./kensho.ts";

type Ids = { data: Record<string, { company_id?: number; error?: string; company_name?: string; name?: string }> };
type Post = { results: Record<string, StatementsResult>; errors?: Record<string, string> };
export type Found = { ticker: string; companyId: number; name: string };

/** Tickers -> Kensho company ids; tickers Kensho doesn't know go into errors. */
export async function resolveIds(k: Kensho, tickers: string[]): Promise<{ found: Found[]; errors: Record<string, string> }> {
  const ids = await k.call<Ids>("ids", { identifiers: tickers });
  const errors: Record<string, string> = {}, found: Found[] = [];
  for (const t of tickers) {
    const r = ids.data?.[t] ?? ids.data?.[t.toLowerCase()];
    if (r?.company_id) found.push({ ticker: t, companyId: r.company_id, name: r.company_name ?? r.name ?? t });
    else errors[t] = r?.error ?? "Not found in Kensho";
  }
  return { found, errors };
}

/** The Comps table for these tickers and period: one row per company plus medians. */
export async function buildComps(k: Kensho, tickers: string[], period: PeriodKind, now: number):
  Promise<{ companies: CompanyOut[]; medians: Record<string, number | null>; errors: Record<string, string> }> {
  const { found, errors } = await resolveIds(k, tickers);
  const cids = found.map((f) => f.companyId);
  if (!cids.length) return { companies: [], medians: {}, errors };

  // statements for everyone at once: five periods of income in the chosen series (latest, year-ago, and
  // what's needed for twelve-month net income), five quarterly balance sheets (latest and a year earlier)
  const [inc, bal] = await Promise.all([
    k.call<Post>("statements/", { company_ids: cids, statement_type: "income_statement", period_type: PERIOD_TYPE[period], num_periods: 5 }),
    k.call<Post>("statements/", { company_ids: cids, statement_type: "balance_sheet", period_type: "quarterly", num_periods: 5 }),
  ]);
  // market cap and shares outstanding (from ten days before the year-ago balance sheet to today, so the latest
  // market cap and the share counts for book value per share come in one call) and earnings calls
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
  return { companies, medians: medians(companies), errors };
}

export type StatementKind = "income_statement" | "balance_sheet" | "cashflow";
export type SeriesKind = "quarterly" | "annual" | "ltm" | "ytd";
/** One company's statement over several periods, as reported (amounts in $M of the reporting currency). */
export async function statementTable(k: Kensho, ticker: string, statement: StatementKind, series: SeriesKind, periods: number) {
  const { found, errors } = await resolveIds(k, [ticker]);
  if (!found.length) return { ticker, error: errors[ticker] };
  const f = found[0];
  const r = await k.call<Post>("statements/", { company_ids: [f.companyId], statement_type: statement, period_type: series, num_periods: periods });
  const res = r.results?.[String(f.companyId)];
  if (!res) return { ticker, name: f.name, error: r.errors?.[String(f.companyId)] ?? "No statements returned" };
  const rows = Object.entries(res.periods ?? {}).sort((a, b) => a[1].period_end_date.localeCompare(b[1].period_end_date)).map(([key, p]) => {
    const items: Record<string, number> = {};
    for (const s of p.statements ?? []) for (const li of s.line_items ?? []) {
      const v = Number(li.value);
      if (li.value !== null && li.value !== "" && isFinite(v) && !(li.name in items)) items[li.name] = Math.round(v / 1e5) / 10;   // $M, 1 dp
    }
    return { period: key, period_end: p.period_end_date, months: p.num_months, items };
  });
  return { ticker, name: f.name, currency: res.currency, statement, series, units: "millions of the reporting currency", periods: rows };
}
