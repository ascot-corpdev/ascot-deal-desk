// Valuation exhibits (trading comparables and historical P/TBV) from Kensho (S&P Global) responses.
// Pure functions, no I/O, so they can be tested. Kensho's response shapes follow its kfinance client
// (POST /statements/, GET /market_cap/, POST /estimates/). Every amount is turned into US$ millions at the
// exchange rate of the day it is measured, so London-listed peers (market cap in GBP) line up with US ones.
// Ascot's own figures never come here: they're typed into the page and stay in the browser tab.

import { cleanTickers, equityOf, itemsOf, NI, NONINS, num, OPEX, pick, PREM, type MarketCaps, type Period, type StatementsResult } from "../comps/core.ts";

export const DAY = 86_400_000;
/** A balance sheet counts from this many days after its period end (roughly when it's published), so the history
    never uses book value before the market could have seen it. */
export const BOOK_LAG_DAYS = 45;
export const MAX_YEARS = 10;

const round = (v: number | null, dp = 1) => (v === null || !isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(Date.parse(d + "T00:00:00Z") + n * DAY);

// ---------- request ----------
export type ValReq = { tickers: string[]; asOf: string; fy: number; years: number; asOfAsked: string };
/** Tickers as on the Comps tab; asOf a past or today's date (blank = today); fy the forward fiscal year (the as-at year
    or the one after); years of P/TBV history (1 to 10). Returns the cleaned request or the reason it's refused. */
export function cleanValuationRequest(body: Record<string, unknown>, now: number): ValReq | string {
  const tickers = cleanTickers(body.tickers);
  if (!tickers) return "Send 1 to 25 tickers, like WRB or LSE:HSX.";
  const today = iso(now);
  const asked = typeof body.asOf === "string" ? body.asOf.trim() : "";
  if (asked && (!/^\d{4}-\d{2}-\d{2}$/.test(asked) || isNaN(Date.parse(asked + "T00:00:00Z")))) return "asOf must be a date like 2026-03-13.";
  if (asked && (asked > today || asked < "2005-01-01")) return "asOf must be between 2005-01-01 and today.";
  const asOf = asked || today, y = +asOf.slice(0, 4);
  const fy = body.fy === undefined || body.fy === null || body.fy === "" ? y : Number(body.fy);
  if (!Number.isInteger(fy) || fy < y || fy > y + 1) return `fy must be ${y} or ${y + 1}.`;
  const years = body.years === undefined ? MAX_YEARS : Number(body.years);
  if (!Number.isInteger(years) || years < 1 || years > MAX_YEARS) return `years must be a whole number from 1 to ${MAX_YEARS}.`;
  return { tickers, asOf, fy, years, asOfAsked: asked };
}
/** First day of the P/TBV history. */
export const historyStart = (asOf: string, years: number) => `${+asOf.slice(0, 4) - years}${asOf.slice(4)}`;

// ---------- exchange rates ----------
/** US$ per unit of each currency, by date (ascending). USD needs no entry. */
export type Fx = Record<string, [string, number][]>;
/** Frankfurter (ECB reference rates) answer with base USD -> US$ per unit. */
export function fxFromFrankfurter(resp: { rates?: Record<string, Record<string, number>> } | null): Fx {
  const out: Fx = {};
  for (const [d, row] of Object.entries(resp?.rates ?? {}).sort((a, b) => a[0].localeCompare(b[0])))
    for (const [ccy, perUsd] of Object.entries(row)) if (perUsd > 0) (out[ccy] ??= []).push([d, 1 / perUsd]);
  return out;
}
/** Currency codes to ask for: pence (GBp, GBX) are priced through GBP. */
export const fxCode = (ccy: string | null | undefined) => { const c = String(ccy || "USD"); return /^(GBp|GBX)$/.test(c) ? "GBP" : c.toUpperCase(); };
/** US$ per unit on a date: the last rate on or up to 10 days before it. */
export function fxRate(fx: Fx, ccy: string | null | undefined, date: string): number | null {
  const c = String(ccy || "USD");
  if (c.toUpperCase() === "USD") return 1;
  const pence = /^(GBp|GBX)$/.test(c), list = fx[fxCode(c)];
  if (!list?.length) return null;
  let lo = 0, hi = list.length - 1, hit = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= date) { hit = m; lo = m + 1; } else hi = m - 1; }
  if (hit < 0 || (Date.parse(date) - Date.parse(list[hit][0])) / DAY > 10) return null;
  return pence ? list[hit][1] / 100 : list[hit][1];
}
const usdM = (v: number | null, ccy: string | null | undefined, date: string, fx: Fx) => {
  if (v === null) return null; const r = fxRate(fx, ccy, date); return r === null ? null : (v * r) / 1e6;
};

// ---------- book value ----------
export type Book = { end: string; bv: number | null; tbv: number | null; debt: number | null; capital: number | null; ccy: string };
const NI_COMMON = [/^Net Income to Common Incl/i, /^Net Income to Common Excl/i, ...NI];
const PREF = [/^Total Preferred Equity/i, /^Preferred Stock(, Total)?$/i];
const GOODWILL = [/^Goodwill$/i];
const INTANG = [/^Other Intangibles$/i, /^Intangible Assets/i];
/** Debt: reported total debt, else short-term borrowings + current and long-term debt. */
function debtOf(m: Map<string, number | null>): number | null {
  const total = pick(m, [/^Total Debt$/i]);
  if (total !== null) return total;
  const parts = [[/^Short[- ]term Borrowings/i], [/^Current Portion of Long[- ]Term Debt/i], [/^Long[- ]Term Debt/i], [/^Debt$/i]].map((p) => pick(m, p));
  return parts.some((x) => x !== null) ? parts.reduce<number>((a, b) => a + (b ?? 0), 0) : null;
}
/** Common book value, tangible book value (less goodwill and other intangibles), debt and capital from one balance sheet. */
export function bookOf(p: Period, ccy: string): Book {
  const m = itemsOf(p);
  const total = equityOf(m);
  const common = pick(m, [/^Total Common Equity$/i]) ?? (total === null ? null : total - (pick(m, PREF) ?? 0));
  const tbv = common === null ? null : common - (pick(m, GOODWILL) ?? 0) - (pick(m, INTANG) ?? 0);
  const debt = debtOf(m);
  return { end: p.period_end_date, bv: common, tbv, debt, capital: debt !== null && total !== null ? debt + total : null, ccy };
}
/** Balance sheets from several series (quarterly, annual), one per period end, oldest first. */
export function booksOf(results: (StatementsResult | null | undefined)[]): Book[] {
  const byEnd = new Map<string, Book>();
  for (const r of results) for (const p of Object.values(r?.periods ?? {})) {
    if (!p?.period_end_date || byEnd.has(p.period_end_date)) continue;
    const b = bookOf(p, r?.currency ?? "USD");
    if (b.bv !== null) byEnd.set(p.period_end_date, b);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}
/** The latest balance sheet public by this date (period end + BOOK_LAG_DAYS), or, for the as-at table, the latest
    period that ended by then when `reported` (Kensho only holds published accounts, so a recent as-at date can use it). */
export function bookAt(books: Book[], date: string, reported = false): Book | null {
  let hit: Book | null = null;
  for (const b of books) if ((reported ? b.end : addDays(b.end, BOOK_LAG_DAYS)) <= date) hit = b;
  return hit;
}

// ---------- annual figures ----------
const fyOf = (key: string, p: Period) => Number(key.match(/^FY(\d{4})$/i)?.[1] ?? p.period_end_date.slice(0, 4));
function annual(r: StatementsResult | null | undefined, fy: number): Period | undefined {
  return Object.entries(r?.periods ?? {}).find(([k, p]) => (p.num_months ?? 12) >= 12 && fyOf(k, p) === fy)?.[1];
}
/** Combined ratio for a fiscal year: operating expenses excluding non-insurance businesses / premiums (derived). */
export function combinedRatio(inc: StatementsResult | null | undefined, fy: number): number | null {
  const m = itemsOf(annual(inc, fy)), prem = pick(m, PREM), opex = pick(m, OPEX);
  return opex !== null && prem ? round(((opex - (pick(m, NONINS) ?? 0)) / prem) * 100) : null;
}
export const netIncomeFY = (inc: StatementsResult | null | undefined, fy: number) => pick(itemsOf(annual(inc, fy)), NI_COMMON);

// ---------- consensus estimates ----------
export type EstItem = { name: string; value: string | number | null; currency?: string | null };
export type Estimates = { periods?: Record<string, { period_end_date: string; estimates: EstItem[] | Record<string, { currency?: string | null; estimates: EstItem[] }> }> };
/** Net income for a fiscal year from Kensho's consensus answer: the reported actual if the year is over, else the
    consensus mean (median if no mean). Capital IQ keeps estimates in millions, so small values are read as $M. */
export function estimateFY(est: Estimates | null | undefined, fy: number): { value: number; ccy: string | null; kind: "actual" | "consensus" } | null {
  const per = Object.entries(est?.periods ?? {}).find(([k, p]) => (k.match(/^FY(\d{4})$/i)?.[1] ?? p.period_end_date?.slice(0, 4)) === String(fy))?.[1];
  if (!per) return null;
  const raw = per.estimates;
  const items: EstItem[] = Array.isArray(raw) ? raw : Object.values(raw ?? {}).flatMap((g) => g.estimates.map((e) => ({ ...e, currency: e.currency ?? g.currency })));
  const find = (re: RegExp) => items.find((e) => re.test(e.name) && num(e.value) !== null);
  const actual = find(/\bactual\b/i), mean = find(/consensus mean/i) ?? find(/\bmean\b/i) ?? find(/median/i);
  const e = actual ?? mean;
  if (!e) return null;
  let v = num(e.value)!;
  if (Math.abs(v) < 1e6) v *= 1e6;
  return { value: v, ccy: e.currency ?? null, kind: actual ? "actual" : "consensus" };
}

// ---------- the as-at table ----------
export type CoIn = { ticker: string; name: string; balQ?: StatementsResult | null; balA?: StatementsResult | null; incA?: StatementsResult | null; caps?: MarketCaps | null; est?: Estimates | null };
export type CoOut = {
  ticker: string; name: string; currency: string; capCurrency: string; capDate: string; bookDate: string;
  marketCap: number | null; bv: number | null; tbv: number | null; pbv: number | null; ptbv: number | null;
  niPrior: number | null; niPriorKind: "actual" | "consensus" | null; niFwd: number | null; niFwdKind: "actual" | "consensus" | null;
  pePrior: number | null; peFwd: number | null; robv: number | null; rotbv: number | null; debtToCap: number | null;
  cr: Record<string, number | null>; notes: string[];
};
const capsSorted = (caps: MarketCaps | null | undefined) =>
  [...(caps?.market_caps ?? [])].map((x) => ({ date: x.date, v: num(x.market_cap) })).filter((x): x is { date: string; v: number } => x.v !== null && x.v > 0).sort((a, b) => a.date.localeCompare(b.date));

/** recent: the as-at date is within BOOK_LAG_DAYS of today, so any balance sheet Kensho holds up to it is already
    published and counts at once; for older dates a balance sheet counts from BOOK_LAG_DAYS after its period end. */
export function computeValuation(c: CoIn, asOf: string, fy: number, fx: Fx, recent = true): CoOut {
  const notes: string[] = [];
  const caps = capsSorted(c.caps).filter((x) => x.date <= asOf);
  const cap = caps.length && (Date.parse(asOf) - Date.parse(caps[caps.length - 1].date)) / DAY <= 10 ? caps[caps.length - 1] : null;
  const capCcy = c.caps?.currency ?? "USD";
  const date = cap?.date ?? asOf;
  const marketCap = cap ? usdM(cap.v, capCcy, date, fx) : null;
  if (!cap) notes.push("No market cap at the as-at date");
  else if (marketCap === null) notes.push(`No ${fxCode(capCcy)} exchange rate for ${date}`);

  const books = booksOf([c.balQ, c.balA]);
  const book = bookAt(books, asOf, recent);
  const ccy = book?.ccy ?? c.incA?.currency ?? c.balQ?.currency ?? "USD";
  if (!book) notes.push("No balance sheet by the as-at date");
  const bv = book ? usdM(book.bv, book.ccy, date, fx) : null, tbv = book ? usdM(book.tbv, book.ccy, date, fx) : null;
  const mult = (a: number | null, b: number | null, dp: number) => (a !== null && b !== null && b > 0 ? round(a / b, dp) : null);

  // prior fiscal year: reported net income, else consensus; forward year: consensus (or the actual once reported)
  const repPrior = netIncomeFY(c.incA, fy - 1);
  const estPrior = repPrior === null ? estimateFY(c.est, fy - 1) : null, estFwd = estimateFY(c.est, fy);
  const niPrior = repPrior !== null ? usdM(repPrior, c.incA?.currency, date, fx) : estPrior ? usdM(estPrior.value, estPrior.ccy ?? ccy, date, fx) : null;
  const niFwd = estFwd ? usdM(estFwd.value, estFwd.ccy ?? ccy, date, fx) : null;
  if (!estFwd) notes.push(`No ${fy} consensus net income`);

  const capital = book && book.debt !== null && book.capital ? book.debt / book.capital : null;
  return {
    ticker: c.ticker, name: c.name, currency: ccy, capCurrency: capCcy, capDate: cap?.date ?? "", bookDate: book?.end ?? "",
    marketCap: round(marketCap), bv: round(bv), tbv: round(tbv), pbv: mult(marketCap, bv, 2), ptbv: mult(marketCap, tbv, 2),
    niPrior: round(niPrior), niPriorKind: repPrior !== null ? "actual" : estPrior?.kind ?? null, niFwd: round(niFwd), niFwdKind: estFwd?.kind ?? null,
    pePrior: niPrior !== null && niPrior > 0 ? mult(marketCap, niPrior, 1) : null, peFwd: niFwd !== null && niFwd > 0 ? mult(marketCap, niFwd, 1) : null,
    robv: niFwd !== null && bv ? round((niFwd / bv) * 100) : null, rotbv: niFwd !== null && tbv && tbv > 0 ? round((niFwd / tbv) * 100) : null,
    debtToCap: capital === null ? null : round(capital * 100),
    cr: { [fy - 2]: combinedRatio(c.incA, fy - 2), [fy - 1]: combinedRatio(c.incA, fy - 1) },
    notes,
  };
}

// ---------- historical P/TBV ----------
/** Daily P/TBV for one company: market cap / tangible book value of the latest balance sheet public by that day,
    both in US$ at that day's rate (so the multiple doesn't move with the exchange rate when both are in the same
    currency). Days with no rate or non-positive tangible book are left out. */
export function ptbvSeries(caps: MarketCaps | null | undefined, books: Book[], start: string, end: string, fx: Fx): [string, number][] {
  const out: [string, number][] = [], ccy = caps?.currency ?? "USD";
  let bi = -1;
  for (const { date, v } of capsSorted(caps)) {
    if (date < start || date > end) continue;
    while (bi + 1 < books.length && addDays(books[bi + 1].end, BOOK_LAG_DAYS) <= date) bi++;
    const b = bi >= 0 ? books[bi] : null;
    if (!b || b.tbv === null) continue;
    const m = usdM(v, ccy, date, fx), t = usdM(b.tbv, b.ccy, date, fx);
    if (m !== null && t !== null && t > 0) out.push([date, Math.round((m / t) * 1000) / 1000]);
  }
  return out;
}
/** Company series on one shared list of dates. A company's last value carries over for up to 7 days, so exchange
    holidays (London versus New York) don't make group averages jump. */
export function alignSeries(series: Record<string, [string, number][]>): { dates: string[]; series: Record<string, (number | null)[]> } {
  const dates = [...new Set(Object.values(series).flatMap((s) => s.map(([d]) => d)))].sort();
  const out: Record<string, (number | null)[]> = {};
  for (const [t, s] of Object.entries(series)) {
    const m = new Map(s), row: (number | null)[] = []; let last: number | null = null, lastAt = "";
    for (const d of dates) {
      const v = m.get(d);
      if (v !== undefined) { last = v; lastAt = d; row.push(v); }
      else row.push(last !== null && (Date.parse(d) - Date.parse(lastAt)) / DAY <= 7 ? last : null);
    }
    out[t] = row;
  }
  return { dates, series: out };
}
