// Runs supabase/functions/valuation under Deno against fake Kensho and Frankfurter APIs. Company names are real
// listed insurers (public peers); every figure here is made up for the test.
(globalThis as any).__VALUATION_TEST__ = true;
const { handle } = await import(new URL("../../supabase/functions/valuation/index.ts", import.meta.url).href);
const V = await import(new URL("../../supabase/functions/valuation/core.ts", import.meta.url).href);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL " + n, JSON.stringify(x)); } };
const now = Date.parse("2026-03-13T18:00:00Z");
const li = (o: Record<string, number>) => Object.entries(o).map(([name, v]) => ({ name, value: String(v) }));
const bal = (end: string, o: Record<string, number>) => ({ period_end_date: end, num_months: 0, statements: [{ name: "Balance Sheet", line_items: li(o) }] });
const inc = (end: string, o: Record<string, number>) => ({ period_end_date: end, num_months: 12, statements: [{ name: "Income Statement", line_items: li(o) }] });

// ---- request
const req0 = V.cleanValuationRequest({ tickers: ["acgl", "lse:hsx"] }, now);
ok("request: defaults to today, this fiscal year, ten years", req0.asOf === "2026-03-13" && req0.fy === 2026 && req0.years === 10 && req0.asOfAsked === "" && JSON.stringify(req0.tickers) === '["ACGL","LSE:HSX"]', req0);
ok("request: as-at date and next fiscal year", (() => { const r = V.cleanValuationRequest({ tickers: ["ACGL"], asOf: "2025-12-31", fy: 2026, years: 5 }, now); return r.asOf === "2025-12-31" && r.fy === 2026 && r.years === 5; })());
ok("request: refused", typeof V.cleanValuationRequest({ tickers: [] }, now) === "string" && typeof V.cleanValuationRequest({ tickers: ["A"], asOf: "2026-04-01" }, now) === "string"
  && typeof V.cleanValuationRequest({ tickers: ["A"], asOf: "13/03/2026" }, now) === "string" && typeof V.cleanValuationRequest({ tickers: ["A"], fy: 2028 }, now) === "string"
  && typeof V.cleanValuationRequest({ tickers: ["A"], years: 11 }, now) === "string");
ok("history start: same day, N years back", V.historyStart("2026-03-13", 10) === "2016-03-13");

// ---- exchange rates
const fx = V.fxFromFrankfurter({ rates: { "2026-03-12": { GBP: 0.8 }, "2026-03-13": { GBP: 0.78125 }, "2016-03-14": { GBP: 0.7 } } });
ok("fx: US$ per unit, oldest first", fx.GBP.length === 3 && fx.GBP[0][0] === "2016-03-14" && Math.abs(V.fxRate(fx, "GBP", "2026-03-13") - 1.28) < 1e-9);
ok("fx: weekend uses the last rate; pence; USD; none", V.fxRate(fx, "GBP", "2026-03-15") === 1.28 && Math.abs(V.fxRate(fx, "GBp", "2026-03-13") - 0.0128) < 1e-12 && V.fxRate(fx, "USD", "x") === 1 && V.fxRate(fx, "EUR", "2026-03-13") === null && V.fxRate(fx, "GBP", "2016-01-01") === null);

// ---- book value
const b = V.bookOf(bal("2025-12-31", { "Total Common Equity": 5000e6, "Goodwill": 300e6, "Other Intangibles": 200e6, "Total Equity": 5600e6, "Short-term Borrowings": 100e6, "Long-Term Debt": 900e6 }), "USD");
ok("book: BV, TBV less goodwill and intangibles, debt, capital", b.bv === 5000e6 && b.tbv === 4500e6 && b.debt === 1000e6 && b.capital === 6600e6, b);
const b2 = V.bookOf(bal("2025-12-31", { "Total Assets": 10000e6, "Total Liabilities - (Template Specific)": 7000e6, "Total Preferred Equity": 500e6, "Total Debt": 800e6 }), "USD");
ok("book: no common equity reported -> assets - liabilities - preferred; total debt used", b2.bv === 2500e6 && b2.tbv === 2500e6 && b2.debt === 800e6 && b2.capital === 3800e6, b2);
const books = V.booksOf([{ currency: "USD", periods: { FY2025Q4: bal("2025-12-31", { "Total Common Equity": 10 }), FY2025Q3: bal("2025-09-30", { "Total Common Equity": 9 }) } },
  { currency: "USD", periods: { FY2025: bal("2025-12-31", { "Total Common Equity": 999 }), FY2024: bal("2024-12-31", { "Total Common Equity": 8 }) } }]);
ok("books: one per period end (quarterly first), oldest first", books.map((x: any) => x.end + ":" + x.bv).join() === "2024-12-31:8,2025-09-30:9,2025-12-31:10", books);
ok("book at a date: public 45 days after period end, or at once when recent", V.bookAt(books, "2026-02-13").end === "2025-09-30" && V.bookAt(books, "2026-02-14").end === "2025-12-31" && V.bookAt(books, "2026-01-05", true).end === "2025-12-31");

// ---- estimates
const est = { periods: {
  FY2025: { period_end_date: "2025-12-31", estimates: [{ name: "Net Income (GAAP) Consensus Mean", value: "1450", currency: "USD" }, { name: "Net Income (GAAP) Actual", value: "1500", currency: "USD" }] },
  FY2026: { period_end_date: "2026-12-31", estimates: [{ name: "Net Income (GAAP) Consensus High", value: "2000", currency: "USD" }, { name: "Net Income (GAAP) Consensus Mean", value: "1600", currency: "USD" }] } } };
ok("estimates: actual once reported, else consensus mean; read as $M", JSON.stringify(V.estimateFY(est, 2025)) === '{"value":1500000000,"ccy":"USD","kind":"actual"}' && V.estimateFY(est, 2026).value === 1600e6 && V.estimateFY(est, 2026).kind === "consensus" && V.estimateFY(est, 2027) === null);
ok("estimates: grouped by listing, full units kept", V.estimateFY({ periods: { FY2026: { period_end_date: "2026-12-31", estimates: { "Company Level": { currency: "GBP", estimates: [{ name: "Net Income (GAAP) Consensus Median", value: "420000000" }] } } } } }, 2026).value === 420e6);

// ---- as-at table: a US company and a London listing with GBP market cap and US$ accounts
const ACGL = {
  ticker: "ACGL", name: "Arch Capital Group Ltd.",
  balQ: { currency: "USD", periods: { FY2025Q4: bal("2025-12-31", { "Total Common Equity": 23000e6, "Goodwill": 600e6, "Other Intangibles": 400e6, "Total Equity": 23800e6, "Long-Term Debt": 2700e6 }) } },
  incA: { currency: "USD", periods: {
    FY2025: inc("2025-12-31", { "Net Premiums Earned": 16000e6, "Total Operating Expenses - (Template Specific)": 13500e6, "Non-Insurance Activities Expenses": 252e6, "Net Income to Common Incl Extra Items": 3300e6 }),
    FY2024: inc("2024-12-31", { "Net Premiums Earned": 15000e6, "Total Operating Expenses - (Template Specific)": 12375e6, "Net Income to Common Incl Extra Items": 4200e6 }) } },
  caps: { currency: "USD", market_caps: [{ date: "2026-03-12", market_cap: "33000000000" }, { date: "2026-03-13", market_cap: "33120000000" }] },
  est,
};
const a = V.computeValuation(ACGL, "2026-03-13", 2026, fx);
ok("ACGL: market cap, BV, TBV in $M", a.marketCap === 33120 && a.bv === 23000 && a.tbv === 22000 && a.capDate === "2026-03-13" && a.bookDate === "2025-12-31", a);
ok("ACGL: P/BV, P/TBV", a.pbv === 1.44 && a.ptbv === 1.51, a);
ok("ACGL: P/E on reported 2025 and consensus 2026", a.niPrior === 3300 && a.niPriorKind === "actual" && a.pePrior === 10 && a.niFwd === 1600 && a.peFwd === 20.7 && a.niFwdKind === "consensus", a);
ok("ACGL: forward returns, debt to capital, combined ratios", a.robv === 7 && a.rotbv === 7.3 && a.debtToCap === 10.2 && a.cr["2024"] === 82.5 && a.cr["2025"] === 82.8 && a.notes.length === 0, a);
const HSX = {
  ticker: "LSE:HSX", name: "Hiscox Ltd",
  balA: { currency: "USD", periods: { FY2025: bal("2025-12-31", { "Total Common Equity": 3200e6, "Goodwill": 100e6, "Other Intangibles": 260e6, "Total Equity": 3200e6, "Long-Term Debt": 680e6 }) } },
  incA: { currency: "USD", periods: {} },
  caps: { currency: "GBP", market_caps: [{ date: "2026-03-13", market_cap: "4100000000" }] },
  est: { periods: { FY2025: { period_end_date: "2025-12-31", estimates: [{ name: "Net Income (GAAP) Consensus Mean", value: "420", currency: "USD" }] } } },
};
const h = V.computeValuation(HSX, "2026-03-13", 2026, fx);
ok("Hiscox: GBP market cap turned into US$ at the as-at rate", h.marketCap === 5248 && h.capCurrency === "GBP" && h.currency === "USD", h);
ok("Hiscox: half-yearly reporter uses the annual balance sheet; P/TBV", h.bookDate === "2025-12-31" && h.bv === 3200 && h.tbv === 2840 && h.ptbv === 1.85 && h.pbv === 1.64, h);
ok("Hiscox: no 2025 accounts yet -> consensus for the prior year; no 2026 consensus noted", h.niPriorKind === "consensus" && h.niPrior === 420 && h.pePrior === 12.5 && h.peFwd === null && h.notes.includes("No 2026 consensus net income"), h);
const old = V.computeValuation(ACGL, "2026-01-20", 2026, fx, false);
ok("older as-at date: balance sheet only after the reporting lag", old.bookDate === "" && old.ptbv === null && old.notes.includes("No balance sheet by the as-at date"), old);
const noFx = V.computeValuation(HSX, "2026-03-13", 2026, {});
ok("no GBP rate: market cap blank with the reason", noFx.marketCap === null && noFx.notes.includes("No GBP exchange rate for 2026-03-13"), noFx.notes);

// ---- history
const hb = V.booksOf([{ currency: "USD", periods: { a: bal("2025-09-30", { "Total Common Equity": 1000e6 }), b: bal("2025-12-31", { "Total Common Equity": 1250e6 }) } }]);
const hs = V.ptbvSeries({ currency: "USD", market_caps: [{ date: "2025-11-01", market_cap: "1" }, { date: "2025-11-14", market_cap: "1500000000" }, { date: "2026-02-13", market_cap: "1600000000" }, { date: "2026-02-16", market_cap: "1600000000" }] }, hb, "2025-11-02", "2026-03-13", fx);
ok("P/TBV series: inside the window, book switches 45 days after period end", JSON.stringify(hs) === '[["2025-11-14",1.5],["2026-02-13",1.6],["2026-02-16",1.28]]', hs);
const al = V.alignSeries({ A: [["2026-01-02", 1], ["2026-01-05", 1.1]], B: [["2026-01-01", 2], ["2026-01-12", 2.2]] });
ok("aligned series: shared dates, last value carried up to 7 days", JSON.stringify(al) === '{"dates":["2026-01-01","2026-01-02","2026-01-05","2026-01-12"],"series":{"A":[null,1,1.1,1.1],"B":[2,2,2,2.2]}}', al);

// ---- handler, against fake Kensho and Frankfurter
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
let estFail = false, fxFail = false;
const log: { url: string; body?: any }[] = [];
const fake = (async (input: string, init: any = {}) => {
  const url = String(input), body = init.body ? JSON.parse(init.body) : undefined;
  log.push({ url, body });
  if (url.endsWith("/oauth2/refresh")) return J({ access_token: "at" });
  if (url.includes("frankfurter")) return fxFail ? J({ message: "down" }, 503) : J({ base: "USD", rates: { "2026-03-12": { GBP: 0.8 }, "2026-03-13": { GBP: 0.78125 } } });
  const path = url.split("/api/v1/")[1] ?? "";
  if (path === "ids") return J({ data: Object.fromEntries(body.identifiers.map((t: string) => [t, t === "ACGL" ? { company_id: 1, company_name: "Arch Capital Group Ltd." } : t === "LSE:HSX" ? { company_id: 2, company_name: "Hiscox Ltd" } : { error: "No identification triple found" }])) });
  if (path === "statements/") {
    const pick = (c: number) => body.statement_type === "income_statement" ? (c === 1 ? ACGL.incA : HSX.incA) : body.period_type === "quarterly" ? (c === 1 ? ACGL.balQ : null) : (c === 1 ? null : HSX.balA);
    return J({ results: Object.fromEntries(body.company_ids.map((c: number) => [String(c), pick(c)]).filter(([, v]: any) => v)) });
  }
  if (path === "estimates/") return estFail ? J({ detail: "Permission denied" }, 403) : J({ results: { "1": est, "2": HSX.est } });
  if (path.startsWith("market_cap/1/")) return J(ACGL.caps);
  if (path.startsWith("market_cap/2/")) return J(HSX.caps);
  return J({ error: "?" }, 404);
}) as unknown as typeof fetch;
const env = (o: Record<string, string> = {}) => (k: string) => ({ KENSHO_REFRESH_TOKEN: "rt", ...o } as Record<string, string>)[k];
const deps = (o: any = {}) => ({ env: env(), fetch: fake, now: () => now, whoIs: async () => "ceo", ...o });
const post = (body: unknown) => new Request("https://x/functions/v1/valuation", { method: "POST", headers: { Authorization: "Bearer u", apikey: "k" }, body: JSON.stringify(body) });

ok("not signed in: 401", (await handle(post({ tickers: ["ACGL"] }), deps({ whoIs: async () => null }))).status === 401);
ok("no Kensho credentials: 503", (await handle(post({ tickers: ["ACGL"] }), deps({ env: env({ KENSHO_REFRESH_TOKEN: "" }) }))).status === 503);
ok("bad request: 400 with the reason", (await (await handle(post({ tickers: ["ACGL"], fy: 2030 }), deps())).json()).error === "fy must be 2026 or 2027.");
ok("nothing asked yet", log.length === 0);

const rows: { id: string; doc: any }[] = [];
const store = async (id: string, doc: any) => { rows.push({ id, doc }); return true; };
let r = await handle(post({ tickers: ["ACGL", "LSE:HSX", "NOPE"], asOf: "", fy: 2026, years: 10 }), deps({ store }));
let body = await r.json();
ok("answers 200 for today's date, saved as valuation:latest", r.status === 200 && body.asOf === "2026-03-13" && body.asOfAsked === "" && body.start === "2016-03-13" && body.saved === true && rows[0].id === "valuation:latest" && rows[0].doc.companies.length === 2, { s: r.status, body: { ...body, history: undefined } });
ok("companies computed; unknown ticker in errors", body.companies.map((c: any) => c.ticker + ":" + c.ptbv).join() === "ACGL:1.51,LSE:HSX:1.85" && body.errors.NOPE, body.companies.map((c: any) => c.ptbv));
const st = log.filter((l) => l.url.endsWith("/statements/")).map((l) => `${l.body.statement_type}/${l.body.period_type}/${l.body.start_year}-${l.body.end_year}`).sort();
ok("statements: quarterly and annual balance sheets back to before the history, annual income for the ratios", JSON.stringify(st) === '["balance_sheet/annual/2015-2026","balance_sheet/quarterly/2015-2026","income_statement/annual/2023-2026"]', st);
const e = log.find((l) => l.url.endsWith("/estimates/"));
ok("estimates: consensus net income for 2025 and 2026", e && e.body.line_item === "net_income_gaap" && e.body.estimate_type === "consensus" && e.body.period_type === "annual" && e.body.fiscal_start_year === 2025 && e.body.fiscal_end_year === 2026, e);
ok("market caps from ten days before the history to the as-at date", log.some((l) => l.url.endsWith("/market_cap/1/2016-03-03/2026-03-13")), log.map((l) => l.url));
const fxCall = log.find((l) => l.url.includes("frankfurter"));
ok("exchange rates asked once, for GBP only, over the same window", log.filter((l) => l.url.includes("frankfurter")).length === 1 && fxCall!.url.includes("2016-03-03..2026-03-13") && fxCall!.url.includes("symbols=GBP") && body.fx.GBP === 1.28, fxCall);
ok("history: aligned series for each company", Array.isArray(body.history.dates) && body.history.series.ACGL && body.history.series["LSE:HSX"] && body.history.dates.length === body.history.series.ACGL.length, body.history);
ok("nothing about Ascot in the request or answer", !JSON.stringify(log).includes("Ascot") && !JSON.stringify(body).includes("Ascot"));

const n0 = log.length;
r = await handle(post({ tickers: ["LSE:HSX", "NOPE", "ACGL"], fy: 2026 }), deps());
ok("same request within 6 hours: from memory", r.status === 200 && log.length === n0);

estFail = true; fxFail = true;
body = await (await handle(post({ tickers: ["ACGL", "LSE:HSX"], refresh: true }), deps())).json();
ok("no estimates permission: still answers, forward P/E blank, says why", body.companies[0].peFwd === null && body.companies[0].pePrior === 10 && body.notes.some((n: string) => n.includes("consensus estimates")), body.notes);
ok("exchange rates down: London listing blank, says why; no store -> saved false", body.companies[1].marketCap === null && body.notes.some((n: string) => n.includes("No exchange rates for GBP")) && body.saved === false, body.notes);
ok("both Frankfurter hosts tried", log.slice(n0).filter((l) => l.url.includes("frankfurter")).length === 2);

console.log(`${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
