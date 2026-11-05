// Public comps from Kensho (S&P Global) responses. Pure functions, no I/O, so they can be tested.
// Response shapes follow Kensho's kfinance client (POST /statements/, GET /market_cap/, GET /earnings/).
// Insurers report on S&P's insurance template, so line items are matched by name with fallbacks.

export type LineItem = { name: string; value: string | number | null };
export type Period = { period_end_date: string; num_months: number; statements: { name: string; line_items: LineItem[] }[] };
export type StatementsResult = { currency: string | null; periods: Record<string, Period> };
type Shares = string | number | { value: string | number | null } | null | undefined;
export type MarketCaps = { currency?: string | null; market_caps: { date: string; market_cap: string | number | null; shares_outstanding?: Shares }[] };
export type Earnings = { earnings: { name: string; key_dev_id: number; datetime: string }[] };

export type CompanyIn = {
  ticker: string; name: string; companyId: number;
  income?: StatementsResult | null; balance?: StatementsResult | null;
  marketCap?: MarketCaps | null; earnings?: Earnings | null;
};
export type CompanyOut = {
  ticker: string; name: string; quarter: string; periodEnd: string; currency: string;
  revenue: number | null; premiums: number | null; netIncome: number | null;
  revenueGrowth: number | null; premiumGrowth: number | null;
  lossRatio: number | null; expenseRatio: number | null; combinedRatio: number | null; roe: number | null; equity: number | null;
  bvps: number | null; bvpsGrowth: number | null;
  marketCap: number | null; marketCapCurrency: string | null; pb: number | null; pe: number | null;
  lastCall: { name: string; date: string } | null; nextCall: { name: string; date: string } | null;
  notes: string[];
};

const num = (v: unknown) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const M = (v: number | null) => (v === null ? null : v / 1e6);
const round = (v: number | null, dp = 1) => (v === null || !isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);

function itemsOf(p?: Period): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const s of p?.statements ?? []) for (const li of s.line_items ?? []) if (!m.has(li.name)) m.set(li.name, num(li.value));
  return m;
}
function pick(m: Map<string, number | null>, patterns: RegExp[]): number | null {
  for (const re of patterns) for (const [k, v] of m) if (re.test(k) && v !== null) return v;
  return null;
}
const REV = [/^Total Revenues?\b/i, /^Revenues?$/i];
const PREM = [/^Net Premiums Earned/i, /^Premiums Earned/i, /^Premiums and Annuity Revenues/i, /^Premiums\b/i];
const NI = [/^Net Income - \(IS\)$/i, /^Net Income to Common Incl/i, /^Net Income$/i, /^Net Income to Company$/i];
const LOSS = [/^Policy Benefits/i, /Loss(es)? and (Loss )?Adjustment Expenses?/i, /^Losses and LAE/i, /^Net Losses/i];
// Underwriting expenses: total operating expenses (losses included, interest excluded) less non-insurance businesses
const OPEX = [/^Total Operating Expenses/i];
const NONINS = [/^Non-Insurance Activities Expenses/i];

/** Equity from a balance sheet: reported total equity, else assets - liabilities - minority interest. */
function equityOf(bal: Map<string, number | null>): number | null {
  const eq = pick(bal, [/^Total Equity$/i, /^Total Common Equity$/i]);
  if (eq !== null) return eq;
  const assets = pick(bal, [/^Total Assets$/i]);
  const liabs = pick(bal, [/^Total Liabilities( - \(Template Specific\))?$/i]);
  const minority = pick(bal, [/^Minority Interest, Total/i, /^Minority Interest$/i]) ?? 0;
  return assets !== null && liabs !== null ? assets - liabs - minority : null;
}
const sharesNum = (s: Shares) => num(s && typeof s === "object" ? s.value : s);
/** Shares outstanding on a date: the last value on or up to 15 days before it. */
export function sharesAt(caps: MarketCaps | null | undefined, date: string): number | null {
  const hit = [...(caps?.market_caps ?? [])].filter((x) => x.date <= date && days(date, x.date) <= 15 && sharesNum(x.shares_outstanding))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return hit ? sharesNum(hit.shares_outstanding) : null;
}

/** Quarters newest first. */
function quarters(r?: StatementsResult | null): [string, Period][] {
  return Object.entries(r?.periods ?? {}).sort((a, b) => b[1].period_end_date.localeCompare(a[1].period_end_date));
}
/** "FY2026Q3" -> "Q3 2026" */
export function quarterLabel(key: string, end: string): string {
  const m = key.match(/^FY(\d{4})Q([1-4])$/i);
  return m ? `Q${m[2]} ${m[1]}` : end;
}
export type PeriodKind = "quarter" | "ytd" | "ltm";
export const PERIOD_TYPE: Record<PeriodKind, string> = { quarter: "quarterly", ytd: "ytd", ltm: "ltm" };
/** Label for the period a figure covers: "Q3 2026", "9M 2026" / "FY 2025" (year to date), "LTM Q3 2026". */
export function periodLabel(kind: PeriodKind, key: string, p: Period): string {
  const q = quarterLabel(key, p.period_end_date), y = key.match(/^FY(\d{4})/i)?.[1] ?? p.period_end_date.slice(0, 4);
  if (kind === "ltm") return `LTM ${q}`;
  if (kind === "ytd") return p.num_months >= 12 ? `FY ${y}` : `${p.num_months}M ${y}`;
  return q;
}
const days = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;

export function computeCompany(c: CompanyIn, now: number, kind: PeriodKind = "quarter"): CompanyOut {
  const notes: string[] = [];
  const qs = quarters(c.income);
  const [latestKey, latest] = qs[0] ?? ["", undefined];
  const li = itemsOf(latest);
  const revenue = pick(li, REV), premiums = pick(li, PREM), netIncome = pick(li, NI), losses = pick(li, LOSS);
  // same period a year earlier (same quarter, same months year to date, or the LTM ending a year before)
  const yearAgo = latest ? qs.find(([, p]) => { const d = days(latest.period_end_date, p.period_end_date); return d > 330 && d < 400; })?.[1] : undefined;
  const ya = itemsOf(yearAgo);
  const growth = (now_: number | null, then: number | null) => (now_ === null || then === null || then === 0 ? null : ((now_ - then) / Math.abs(then)) * 100);
  const revenueGrowth = growth(revenue, pick(ya, REV)), premiumGrowth = growth(premiums, pick(ya, PREM));
  if (latest && !yearAgo) notes.push("No year-ago period for growth");
  // last twelve months' net income, for P/E, from whichever series was fetched
  let ltmNI: number | null = null;
  if (kind === "ltm" || (latest && latest.num_months >= 12)) ltmNI = netIncome;
  else if (kind === "quarter") {
    const last4 = qs.slice(0, 4).map(([, p]) => pick(itemsOf(p), NI));
    ltmNI = last4.length === 4 && last4.every((v) => v !== null) ? (last4 as number[]).reduce((a, b) => a + b, 0) : null;
  } else if (latest && yearAgo) {
    // year to date: this YTD + the last full fiscal year - the same YTD a year earlier
    const fy = qs.find(([, p]) => p.num_months >= 12 && p.period_end_date < latest.period_end_date && p.period_end_date > yearAgo.period_end_date)?.[1];
    const a = netIncome, b = fy ? pick(itemsOf(fy), NI) : null, cc = pick(ya, NI);
    ltmNI = a !== null && b !== null && cc !== null ? a + b - cc : null;
  }
  const months = latest?.num_months && latest.num_months > 0 ? latest.num_months : 3;

  // combined ratio = (operating expenses - non-insurance expenses) / premiums; expense ratio = combined - loss
  const opex = pick(li, OPEX), nonIns = pick(li, NONINS) ?? 0;
  const combinedRatio = opex !== null && premiums ? round(((opex - nonIns) / premiums) * 100) : null;
  const lossRatio = losses !== null && premiums ? round((losses / premiums) * 100) : null;
  const expenseRatio = combinedRatio !== null && lossRatio !== null ? round(combinedRatio - lossRatio) : null;

  // balance sheet: latest quarter and the one a year earlier, for book value per share growth
  const bqs = quarters(c.balance);
  const [, bLatest] = bqs[0] ?? ["", undefined];
  const equity = equityOf(itemsOf(bLatest));
  const bYearAgo = bLatest ? bqs.find(([, p]) => { const d = days(bLatest.period_end_date, p.period_end_date); return d > 330 && d < 400; })?.[1] : undefined;
  const sh = bLatest ? sharesAt(c.marketCap, bLatest.period_end_date) : null;
  const shYA = bYearAgo ? sharesAt(c.marketCap, bYearAgo.period_end_date) : null;
  const eqYA = bYearAgo ? equityOf(itemsOf(bYearAgo)) : null;
  const bvps = equity !== null && sh ? equity / sh : null, bvpsYA = eqYA !== null && shYA ? eqYA / shYA : null;
  const bvpsGrowth = growth(bvps, bvpsYA);
  if (bLatest && bvpsGrowth === null) notes.push(!sh ? "No share count for book value per share" : "No year-ago book value per share");

  const caps = [...(c.marketCap?.market_caps ?? [])].filter((x) => num(x.market_cap) !== null).sort((a, b) => b.date.localeCompare(a.date));
  const marketCap = caps.length ? num(caps[0].market_cap) : null;
  const capCcy = c.marketCap?.currency ?? null;
  const ccy = c.income?.currency ?? c.balance?.currency ?? null;
  const sameCcy = !capCcy || !ccy || capCcy === ccy;
  if (!sameCcy) notes.push(`Market cap in ${capCcy}, accounts in ${ccy}: P/B and P/E not shown`);

  const calls = [...(c.earnings?.earnings ?? [])].map((e) => ({ name: e.name, date: e.datetime })).sort((a, b) => a.date.localeCompare(b.date));
  const past = calls.filter((e) => Date.parse(e.date) <= now), future = calls.filter((e) => Date.parse(e.date) > now);

  return {
    ticker: c.ticker, name: c.name, quarter: latest ? periodLabel(kind, latestKey, latest) : "n/d",
    periodEnd: latest?.period_end_date ?? "", currency: ccy ?? "",
    revenue: round(M(revenue)), premiums: round(M(premiums)), netIncome: round(M(netIncome)),
    revenueGrowth: round(revenueGrowth), premiumGrowth: round(premiumGrowth),
    lossRatio, expenseRatio, combinedRatio,
    bvps: round(bvps, 2), bvpsGrowth: round(bvpsGrowth),
    roe: netIncome !== null && equity ? round(((netIncome * (12 / months)) / equity) * 100) : null,   // annualised
    equity: round(M(equity)),
    marketCap: round(M(marketCap)), marketCapCurrency: capCcy,
    pb: sameCcy && marketCap !== null && equity ? round(marketCap / equity, 2) : null,
    pe: sameCcy && marketCap !== null && ltmNI && ltmNI > 0 ? round(marketCap / ltmNI, 1) : null,
    lastCall: past.length ? past[past.length - 1] : null, nextCall: future.length ? future[0] : null,
    notes,
  };
}

export function median(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x !== null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return round(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2, 2);
}
export const MEDIAN_FIELDS = ["revenueGrowth", "premiumGrowth", "lossRatio", "expenseRatio", "combinedRatio", "roe", "bvpsGrowth", "pb", "pe"] as const;
export function medians(rows: CompanyOut[]): Record<string, number | null> {
  return Object.fromEntries(MEDIAN_FIELDS.map((k) => [k, median(rows.map((r) => r[k] as number | null))]));
}

/** Tickers as typed in the app: "WRB", "LSE:HSX". Anything else is refused before calling Kensho. */
export function cleanTickers(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = [...new Set(input.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
  if (!out.length || out.length > 25 || out.some((t) => !/^[A-Z0-9][A-Z0-9:._-]{0,24}$/.test(t))) return null;
  return out;
}
