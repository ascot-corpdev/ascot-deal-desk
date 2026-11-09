// Runs supabase/functions/comps under Deno against a fake Kensho API shaped like the real one.
(globalThis as any).__COMPS_TEST__ = true;
const { handle } = await import(new URL("../../supabase/functions/comps/index.ts", import.meta.url).href);
const { allowOrigin } = await import(new URL("../../supabase/functions/comps/index.ts", import.meta.url).href);
const { computeCompany, cleanTickers, quarterLabel } = await import(new URL("../../supabase/functions/comps/core.ts", import.meta.url).href);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL " + n, JSON.stringify(x)); } };
const now = Date.parse("2026-11-05T12:00:00Z");
const li = (o: Record<string, number>) => Object.entries(o).map(([name, v]) => ({ name, value: String(v), sources: [] }));
const isQ = (end: string, items: Record<string, number>) => ({ period_end_date: end, num_months: 3, statements: [{ name: "Income Statement", line_items: li(items) }] });
// W. R. Berkley Q3 2026 from S&P (via this session's S&P Global connection); earlier quarters made up for the test
const WRB_INC = { currency: "USD", periods: {
  FY2026Q3: isQ("2026-09-30", { "Premiums and Annuity Revenues": 3213604000, "Total Revenues - (Template Specific)": 3738811000, "Policy Benefits": 1998469000, "Total Operating Expenses - (Template Specific)": 3137995000, "Non-Insurance Activities Expenses": 124845000, "Net Income - (IS)": 446005000, "Net Income to Company": 448325000 }),
  FY2026Q2: isQ("2026-06-30", { "Premiums and Annuity Revenues": 3100000000, "Total Revenues - (Template Specific)": 3600000000, "Net Income - (IS)": 400000000 }),
  FY2026Q1: isQ("2026-03-31", { "Premiums and Annuity Revenues": 3000000000, "Total Revenues - (Template Specific)": 3500000000, "Net Income - (IS)": 420000000 }),
  FY2025Q4: isQ("2025-12-31", { "Premiums and Annuity Revenues": 2950000000, "Total Revenues - (Template Specific)": 3450000000, "Net Income - (IS)": 434000000 }),
  FY2025Q3: isQ("2025-09-30", { "Premiums and Annuity Revenues": 2921458182, "Total Revenues - (Template Specific)": 3398919091, "Net Income - (IS)": 360000000 }),
} };
const WRB_BAL = { currency: "USD", periods: { FY2026Q3: { period_end_date: "2026-09-30", num_months: 0, statements: [{ name: "Balance Sheet", line_items: li({ "Total Assets": 45675961000, "Total Liabilities - (Template Specific)": 36055288000, "Minority Interest, Total - (Template Specific)": 10460000, "Total Liabilities And Equity": 45675961000 }) }] },
  FY2025Q3: { period_end_date: "2025-09-30", num_months: 0, statements: [{ name: "Balance Sheet", line_items: li({ "Total Assets": 43715217000, "Total Liabilities - (Template Specific)": 33910214000, "Minority Interest, Total - (Template Specific)": 6111000 }) }] } } };
// WRB shares outstanding from S&P (kfinance returns them with the market caps)
const WRB_SHARES = [{ date: "2025-09-30", market_cap: null, tev: null, shares_outstanding: "396952070" }, { date: "2026-09-30", market_cap: null, tev: null, shares_outstanding: "388606339" }];
const HSX_INC = { currency: "USD", periods: { FY2026Q2: isQ("2026-06-30", { "Net Premiums Earned": 1000000000, "Total Revenues": 1100000000, "Net Income - (IS)": 150000000 }) } };
const HSX_BAL = { currency: "USD", periods: { FY2026Q2: { period_end_date: "2026-06-30", num_months: 0, statements: [{ name: "Balance Sheet", line_items: li({ "Total Equity": 3000000000 }) }] } } };

type Log = { url: string; method: string; body?: any; auth?: string | null };
function fakeKensho(opts: { expireFirst?: boolean; okta?: (body: URLSearchParams) => Promise<boolean> } = {}) {
  const log: Log[] = []; let tokenN = 0, expired = !!opts.expireFirst;
  const f = (async (input: string, init: any = {}) => {
    const url = String(input), method = init.method ?? "GET";
    const body = init.body instanceof URLSearchParams ? init.body : init.body ? JSON.parse(init.body) : undefined;
    log.push({ url, method, body, auth: init.headers?.Authorization ?? null });
    const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (url === "https://kfinance.kensho.com/oauth2/refresh") return body?.refresh_token === "rt-good" ? J({ access_token: "at" + (++tokenN) }) : J({ error: "bad" }, 401);
    if (url === "https://kensho.okta.com/oauth2/default/v1/token") return (opts.okta && await opts.okta(body)) ? J({ access_token: "at" + (++tokenN) }) : J({ error: "bad" }, 401);
    if (!url.startsWith("https://kfinance.kensho.com/api/v1/")) return J({ error: "unknown host" }, 404);
    if (expired) { expired = false; return J({ error: "expired" }, 401); }
    const path = url.slice("https://kfinance.kensho.com/api/v1/".length);
    if (path === "ids") return J({ data: Object.fromEntries(body.identifiers.map((t: string) => [t, t === "WRB" ? { company_id: 254504, security_id: 1, trading_item_id: 2, company_name: "W. R. Berkley Corporation", ticker: "NYSE:WRB", country: "USA" } : t === "LSE:HSX" ? { company_id: 128346, security_id: 3, trading_item_id: 4, company_name: "Hiscox Ltd", ticker: "LSE:HSX", country: "BMU" } : { error: `No identification triple found for the provided identifier: ${t} of type: ticker` }])) });
    if (path === "statements/") {
      const inc = body.statement_type === "income_statement";
      return J({ results: Object.fromEntries(body.company_ids.map((c: number) => [String(c), c === 254504 ? (inc ? WRB_INC : WRB_BAL) : (inc ? HSX_INC : HSX_BAL)])) });
    }
    if (path.startsWith("market_cap/254504/")) return J({ currency: "USD", market_caps: [...WRB_SHARES, { date: "2026-11-03", market_cap: "29500000000.00", tev: null, shares_outstanding: null }, { date: "2026-11-04", market_cap: "29832103692.00", tev: null, shares_outstanding: null }] });
    if (path.startsWith("market_cap/128346/")) return J({ currency: "GBP", market_caps: [{ date: "2026-11-04", market_cap: "4100000000.00" }] });
    if (path === "earnings/254504") return J({ earnings: [
      { name: "W. R. Berkley Corporation, Q2 2026 Earnings Call, Jul 20, 2026", key_dev_id: 1, datetime: "2026-07-20T21:00:00Z" },
      { name: "W. R. Berkley Corporation, Q3 2026 Earnings Call, Oct 19, 2026", key_dev_id: 2022855781, datetime: "2026-10-19T21:00:00Z" },
      { name: "W. R. Berkley Corporation, Q4 2026 Earnings Call, Jan 25, 2027", key_dev_id: 3, datetime: "2027-01-25T21:00:00Z" } ] });
    if (path === "earnings/128346") return J({ error: "no access" }, 403);
    return J({ error: "?" }, 404);
  }) as unknown as typeof fetch;
  return { f, log };
}
const req = (body: unknown, method = "POST") => new Request("https://x/functions/v1/comps", { method, headers: { Authorization: "Bearer u", apikey: "k" }, body: method === "POST" ? JSON.stringify(body) : undefined });
const env = (o: Record<string, string>) => (k: string) => o[k];
const signedIn = async () => "ceo", anon = async () => null;

// --- pure calculations on WRB's real Q3
const wrb = computeCompany({ ticker: "WRB", name: "W. R. Berkley Corporation", companyId: 254504, income: WRB_INC as any, balance: WRB_BAL as any,
  marketCap: { currency: "USD", market_caps: [...WRB_SHARES, { date: "2026-11-04", market_cap: "29832103692.00" }] } as any, earnings: null }, now);
ok("quarter label", wrb.quarter === "Q3 2026" && quarterLabel("FY2025Q4", "") === "Q4 2025");
ok("revenue, premiums, net income in $M", wrb.revenue === 3738.8 && wrb.premiums === 3213.6 && wrb.netIncome === 446, wrb);
ok("loss ratio = policy benefits / premiums", wrb.lossRatio === 62.2, wrb.lossRatio);
ok("equity derived = assets - liabilities - minority", wrb.equity === 9610.2, wrb.equity);
ok("ROE annualised", wrb.roe === 18.6, wrb.roe);
ok("P/B", wrb.pb === 3.1, wrb.pb);
ok("P/E on last four quarters (29,832 / 1,700)", wrb.pe === 17.5, wrb.pe);
ok("combined ratio = (operating expenses - non-insurance) / premiums; expense ratio = combined - loss", wrb.combinedRatio === 93.8 && wrb.expenseRatio === 31.6, [wrb.combinedRatio, wrb.expenseRatio]);
ok("book value per share and growth vs a year earlier", wrb.bvps === 24.73 && wrb.bvpsGrowth === 0.2, [wrb.bvps, wrb.bvpsGrowth]);
const shObj = computeCompany({ ticker: "WRB", name: "W", companyId: 1, income: WRB_INC as any, balance: WRB_BAL as any,
  marketCap: { currency: "USD", market_caps: WRB_SHARES.map((x) => ({ ...x, shares_outstanding: { value: x.shares_outstanding, unit: "Shares" } })) } as any, earnings: null }, now);
ok("shares as {value} objects also read", shObj.bvps === 24.73 && shObj.bvpsGrowth === 0.2, [shObj.bvps, shObj.bvpsGrowth]);
const noYA = computeCompany({ ticker: "WRB", name: "W", companyId: 1, income: WRB_INC as any, balance: { currency: "USD", periods: { FY2026Q3: WRB_BAL.periods.FY2026Q3 } } as any,
  marketCap: { currency: "USD", market_caps: WRB_SHARES } as any, earnings: null }, now);
ok("no year-ago balance sheet: BVPS shown, growth blank with a note", noYA.bvps === 24.73 && noYA.bvpsGrowth === null && noYA.notes.includes("No year-ago book value per share"), noYA);
const noSh = computeCompany({ ticker: "WRB", name: "W", companyId: 1, income: WRB_INC as any, balance: WRB_BAL as any, marketCap: { currency: "USD", market_caps: [] }, earnings: null }, now);
ok("no share count: blank with a note", noSh.bvps === null && noSh.notes.includes("No share count for book value per share"), noSh.notes);
ok("growth vs same quarter last year", wrb.premiumGrowth === 10 && wrb.revenueGrowth === 10, [wrb.premiumGrowth, wrb.revenueGrowth]);
ok("ticker cleaning", JSON.stringify(cleanTickers([" wrb", "lse:hsx", "WRB"])) === '["WRB","LSE:HSX"]' && cleanTickers(["bad ticker"]) === null && cleanTickers([]) === null && cleanTickers(Array(26).fill(0).map((_, i) => "T" + i)) === null);

// --- the function
ok("GET refused", (await handle(req(null, "GET"), { env: env({}), fetch, whoIs: signedIn })).status === 405);
ok("not signed in refused", (await handle(req({ tickers: ["WRB"] }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch, whoIs: anon })).status === 401);
const nc = await handle(req({ tickers: ["WRB"] }), { env: env({}), fetch, whoIs: signedIn });
ok("no credentials: clear 503", nc.status === 503 && (await nc.json()).error === "not_configured");
ok("bad tickers: 400", (await handle(req({ tickers: ["no spaces"] }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch, whoIs: signedIn })).status === 400);

let k = fakeKensho();
let r = await handle(req({ tickers: ["WRB", "LSE:HSX", "NOPE"] }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch: k.f, whoIs: signedIn, now: () => now });
let b = await r.json();
await Deno.writeTextFile(new URL("../out/comps_sample.json", import.meta.url), JSON.stringify(b));
ok("200 with two companies", r.status === 200 && b.companies.length === 2, b);
const W = b.companies.find((c: any) => c.ticker === "WRB"), H = b.companies.find((c: any) => c.ticker === "LSE:HSX");
ok("WRB end to end", W.name === "W. R. Berkley Corporation" && W.pb === 3.1 && W.marketCap === 29832.1 && W.lastCall.date === "2026-10-19T21:00:00Z" && W.nextCall.date === "2027-01-25T21:00:00Z", W);
ok("Hiscox: Total Equity used, GBP market cap so no P/B or P/E, note says why", H.equity === 3000 && H.pb === null && H.pe === null && H.notes.some((n: string) => n.includes("GBP")) && H.lastCall === null, H);
ok("unknown ticker reported, not fatal", b.errors.NOPE?.startsWith("No identification triple"), b.errors);
ok("medians", b.medians.roe === 19.3 && b.medians.lossRatio === 62.2 && b.medians.combinedRatio === 93.8 && b.medians.bvpsGrowth === 0.2, b.medians);
ok("end to end: WRB combined ratio and BVPS growth; balance sheets asked for five quarters", W.combinedRatio === 93.8 && W.bvpsGrowth === 0.2 && k.log.find((l) => l.body?.statement_type === "balance_sheet")?.body.num_periods === 5, W);
ok("source named", b.source === "S&P Global Capital IQ via Kensho");
const calls = k.log.map((l) => l.url.replace("https://kfinance.kensho.com", ""));
ok("one sign-in, ids, two statement calls, per-company cap and earnings", calls[0] === "/oauth2/refresh" && calls.filter((u) => u === "/api/v1/statements/").length === 2 && calls.some((u) => u.startsWith("/api/v1/market_cap/254504/2025-09-20/2026-11-05")) && calls.some((u) => u.startsWith("/api/v1/market_cap/128346/2026-06-20/2026-11-05")), calls);
ok("bearer token sent", k.log.filter((l) => l.url.includes("/api/v1/")).every((l) => l.auth === "Bearer at1"));
ok("statement request body", JSON.stringify(k.log.find((l) => l.url.endsWith("statements/"))!.body) === JSON.stringify({ company_ids: [254504, 128346], statement_type: "income_statement", period_type: "quarterly", num_periods: 5 }));
const before = k.log.length;
await handle(req({ tickers: ["NOPE", "LSE:HSX", "WRB"] }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch: k.f, whoIs: signedIn, now: () => now + 60_000 });
ok("cached for 10 minutes (same tickers, any order)", k.log.length === before);
// saved for the page: only "refresh" skips the memory, and every fetch is written to kensho_store
const savedRows: { id: string; doc: any }[] = [];
const store = async (id: string, doc: any) => { savedRows.push({ id, doc }); return true; };
r = await handle(req({ tickers: ["WRB", "LSE:HSX", "NOPE"], refresh: true }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch: k.f, whoIs: signedIn, now: () => now + 120_000, store });
b = await r.json();
ok("refresh: asks Kensho again despite the memory", k.log.length > before);
ok("refresh: saved as comps:quarter with the tickers, and says so", b.saved === true && savedRows.length === 1 && savedRows[0].id === "comps:quarter" && JSON.stringify(savedRows[0].doc.tickers) === '["WRB","LSE:HSX","NOPE"]' && savedRows[0].doc.companies.length === 2 && !("saved" in savedRows[0].doc), savedRows);
const { serviceKey } = await import(new URL("../../supabase/functions/comps/store.ts", import.meta.url).href);
ok("service key: legacy name, else the first new secret key, else none", serviceKey((k: string) => ({ SUPABASE_SERVICE_ROLE_KEY: "legacy" } as any)[k]) === "legacy" && serviceKey((k: string) => ({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' } as any)[k]) === "sb_secret_x" && serviceKey(() => undefined) === undefined);

// expired token: one retry with a fresh sign-in
k = fakeKensho({ expireFirst: true });
r = await handle(req({ tickers: ["LSE:HSX"] }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good", X: "1" }), fetch: k.f, whoIs: signedIn, now: () => now + 2 * 3600_000 });
ok("401 from Kensho: signs in again and succeeds", r.status === 200 && k.log.filter((l) => l.url.endsWith("/oauth2/refresh")).length === 2, k.log.map((l) => l.url));
// bad refresh token
k = fakeKensho();
r = await handle(req({ tickers: ["WRB", "X1"] }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-bad" }), fetch: k.f, whoIs: signedIn, now: () => now + 3 * 3600_000 });
b = await r.json();
ok("bad credentials: 502 kensho_auth", r.status === 502 && b.error === "kensho_auth", b);

// key pair: a real RS256 signature, verified by the fake Okta
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pk8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
let s = ""; for (const x of pk8) s += String.fromCharCode(x);
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(s).match(/.{1,64}/g)!.join("\n") + "\n-----END PRIVATE KEY-----";
let seen: any = null;
k = fakeKensho({ okta: async (form) => {
  const a = form.get("client_assertion")!; const [h, p, sig] = a.split(".");
  const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((x.length + 3) % 4)), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, dec(sig), new TextEncoder().encode(h + "." + p));
  seen = { valid, head: JSON.parse(new TextDecoder().decode(dec(h))), claims: JSON.parse(new TextDecoder().decode(dec(p))), scope: form.get("scope"), grant: form.get("grant_type"), type: form.get("client_assertion_type") };
  return valid;
} });
r = await handle(req({ tickers: ["WRB"] }), { env: env({ KENSHO_CLIENT_ID: "cid-123", KENSHO_PRIVATE_KEY: pem.replace(/\n/g, "\\n"), KENSHO_KEY_ID: "kid-9" }), fetch: k.f, whoIs: signedIn, now: () => now + 4 * 3600_000 });
ok("key pair: signed JWT accepted", r.status === 200 && seen?.valid === true, seen);
ok("key pair: claims and form match Kensho's client", seen.head.alg === "RS256" && seen.head.kid === "kid-9" && seen.claims.aud === "https://kensho.okta.com/oauth2/default/v1/token" && seen.claims.sub === "cid-123" && seen.claims.iss === "cid-123" && seen.claims.exp - seen.claims.iat === 3600 && seen.scope === "kensho:app:kfinance" && seen.grant === "client_credentials" && seen.type === "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", seen);
const pkcs1 = await handle(req({ tickers: ["WRB"] }), { env: env({ KENSHO_CLIENT_ID: "c2", KENSHO_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----" }), fetch: k.f, whoIs: signedIn, now: () => now + 5 * 3600_000 });
ok("PKCS#1 key: explains the conversion", pkcs1.status === 502 && (await pkcs1.json()).message.includes("PKCS#8"));

// YTD and LTM, with W. R. Berkley's actual series from S&P (premiums, revenues, policy benefits, net income)
const per = (end: string, months: number, prem: number, rev: number, pb: number, ni: number) => ({ period_end_date: end, num_months: months, statements: [{ name: "Income Statement", line_items: li({ "Premiums and Annuity Revenues": prem, "Total Revenues - (Template Specific)": rev, "Policy Benefits": pb, "Net Income - (IS)": ni }) }] });
const WRB_YTD = { currency: "USD", periods: {
  FY2025Q3: per("2025-09-30", 9, 9266948000, 10986443000, 5825073000, 1329892000),
  FY2025Q4: per("2025-12-31", 12, 12446938000, 14707856000, 7771657000, 1779403000),
  FY2026Q1: per("2026-03-31", 3, 3115172000, 3690334000, 1936025000, 515216000),
  FY2026Q2: per("2026-06-30", 6, 6302561000, 7406453000, 3896556000, 967478000),
  FY2026Q3: per("2026-09-30", 9, 9516165000, 11145264000, 5895026000, 1413483000) } };
const WRB_LTM = { currency: "USD", periods: {
  FY2025Q3: per("2025-09-30", 12, 12277848000, 14654011000, 7686334000, 1905993000),
  FY2025Q4: per("2025-12-31", 12, 12446938000, 14707856000, 7771657000, 1779403000),
  FY2026Q1: per("2026-03-31", 12, 12549729000, 14850791000, 7806890000, 1877048000),
  FY2026Q2: per("2026-06-30", 12, 12638933000, 14896102000, 7811997000, 1928021000),
  FY2026Q3: per("2026-09-30", 12, 12696155000, 14866677000, 7841610000, 1862994000) } };
const cap = { currency: "USD", market_caps: [{ date: "2026-11-04", market_cap: "29832103692.00" }] };
const y = computeCompany({ ticker: "WRB", name: "W", companyId: 1, income: WRB_YTD as any, balance: WRB_BAL as any, marketCap: cap, earnings: null }, now, "ytd");
ok("YTD label", y.quarter === "9M 2026", y.quarter);
ok("YTD figures and growth vs 9M 2025", y.premiums === 9516.2 && y.premiumGrowth === 2.7 && y.revenueGrowth === 1.4 && y.lossRatio === 61.9, y);
ok("YTD ROE annualised (x12/9)", y.roe === 19.6, y.roe);
ok("YTD P/E from YTD + FY2025 - 9M 2025 = LTM net income", y.pe === 16, y.pe);
const l = computeCompany({ ticker: "WRB", name: "W", companyId: 1, income: WRB_LTM as any, balance: WRB_BAL as any, marketCap: cap, earnings: null }, now, "ltm");
ok("LTM label", l.quarter === "LTM Q3 2026", l.quarter);
ok("LTM figures and growth vs LTM a year earlier", l.premiums === 12696.2 && l.premiumGrowth === 3.4 && l.lossRatio === 61.8, l);
ok("LTM ROE not annualised again", l.roe === 19.4, l.roe);
ok("LTM P/E matches the YTD-derived figure", l.pe === 16 && l.pe === y.pe, [l.pe, y.pe]);
const fyOnly = computeCompany({ ticker: "WRB", name: "W", companyId: 1, income: { currency: "USD", periods: { FY2025Q4: WRB_YTD.periods.FY2025Q4 } } as any, balance: WRB_BAL as any, marketCap: cap, earnings: null }, now, "ytd");
ok("YTD at fiscal year end reads FY", fyOnly.quarter === "FY 2025" && fyOnly.pe === round1(29832.1 / 1779.4), fyOnly);
function round1(v: number) { return Math.round(v * 10) / 10; }
// period goes through to Kensho and into the cache key
k = fakeKensho();
const q1 = await (await handle(req({ tickers: ["WRB"], period: "ytd" }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch: k.f, whoIs: signedIn, now: () => now + 6 * 3600_000 })).json();
const incReq = k.log.find((x) => x.url.endsWith("statements/") && x.body.statement_type === "income_statement");
ok("YTD request asks Kensho for the ytd series", incReq?.body.period_type === "ytd" && incReq?.body.num_periods === 5 && q1.period === "ytd", incReq?.body);
const n1 = k.log.length;
await handle(req({ tickers: ["WRB"], period: "ltm" }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch: k.f, whoIs: signedIn, now: () => now + 6 * 3600_000 });
ok("LTM is cached separately from YTD", k.log.length > n1 && k.log.some((x) => x.body?.period_type === "ltm"));
ok("bad period refused", (await handle(req({ tickers: ["WRB"], period: "weekly" }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch: k.f, whoIs: signedIn })).status === 400);
ok("no period means latest quarter", (await (await handle(req({ tickers: ["WRB"] }), { env: env({ KENSHO_REFRESH_TOKEN: "rt-good" }), fetch: k.f, whoIs: signedIn, now: () => now + 6 * 3600_000 })).json()).period === "quarter");

// CORS: ALLOWED_ORIGIN with a path, a trailing slash, or a list; and errors still carry CORS headers
const SITE = "https://ascot-corpdev.github.io";
ok("origin with path and slash", allowOrigin("https://ascot-corpdev.github.io/ascot-deal-desk/", SITE) === SITE);
ok("list of origins", allowOrigin("http://localhost:8080, https://ascot-corpdev.github.io", SITE) === SITE && allowOrigin("http://localhost:8080, https://ascot-corpdev.github.io", "http://localhost:8080") === "http://localhost:8080");
ok("unset means any", allowOrigin(undefined, SITE) === "*" && allowOrigin("  ", SITE) === "*");
ok("other origin gets the configured one (browser blocks it)", allowOrigin("https://ascot-corpdev.github.io", "https://evil.example") === SITE);
const pre = await handle(new Request("https://x/functions/v1/comps", { method: "OPTIONS", headers: { Origin: SITE } }), { env: env({ ALLOWED_ORIGIN: SITE + "/ascot-deal-desk/" }), fetch, whoIs: signedIn });
ok("preflight answers with the site's origin", pre.status === 200 && pre.headers.get("Access-Control-Allow-Origin") === SITE && (pre.headers.get("Access-Control-Allow-Headers") || "").includes("apikey"));
const boom = await handle(new Request("https://x/functions/v1/comps", { method: "POST", headers: { Origin: SITE, Authorization: "Bearer u" }, body: "{}" }), { env: env({ ALLOWED_ORIGIN: SITE, KENSHO_REFRESH_TOKEN: "rt-good" }), fetch, whoIs: async () => { throw new Error("SUPABASE_URL is not set"); } });
const bb = await boom.json();
ok("unexpected failure: 500 with CORS and the reason", boom.status === 500 && boom.headers.get("Access-Control-Allow-Origin") === SITE && bb.message.includes("SUPABASE_URL is not set"), bb);

console.log(`${pass} passed, ${fail} failed`); if (fail) Deno.exit(1);
