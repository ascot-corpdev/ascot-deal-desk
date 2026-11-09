// Runs supabase/functions/league under Deno against a fake Kensho API. Firm names are real banks (public advisors);
// every company, target and deal here is made up.
(globalThis as any).__LEAGUE_TEST__ = true;
const { handle } = await import(new URL("../../supabase/functions/league/index.ts", import.meta.url).href);
const { cleanCompanies, sinceDate, pickDeals, toDeal, MAX_DEALS } = await import(new URL("../../supabase/functions/league/core.ts", import.meta.url).href);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL " + n, JSON.stringify(x)); } };
const now = Date.parse("2026-11-09T12:00:00Z");
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

// ---- pure helpers
ok("companies: cleaned and capped", JSON.stringify(cleanCompanies([" wrb", "WRB", "lse:hsx"])) === '["WRB","LSE:HSX"]' && cleanCompanies([]) === null && cleanCompanies(Array.from({ length: 41 }, (_, i) => "T" + i)) === null && cleanCompanies(["bad ticker"]) === null);
ok("since: same day N years back", sinceDate(now, 3) === "2023-11-09");
const s = (id: number, start: string, status = "Closed") => ({ transaction_id: id, status, start_date: start, closed_date: null, target: "T" + id, buyers: [] });
const pd = pickDeals([{ ticker: "AAA", resp: { buyer: [s(1, "2025-01-01"), s(2, "2020-01-01"), s(3, "2025-06-01", "Cancelled")], seller: [], target: [] } },
  { ticker: "BBB", resp: { seller: [s(1, "2025-01-01"), s(4, "2026-02-01", "Announced")] } }, { ticker: "CCC", resp: null }], "2023-11-09");
ok("pick: deduped, recent first, old and cancelled left out, remembers who it came from",
  JSON.stringify(pd.picked.map(([id, v]: any) => id + ":" + v.via.join("+"))) === '["4:BBB","1:AAA+BBB"]' && pd.dropped === 0, pd.picked);
const lots = pickDeals([{ ticker: "AAA", resp: { buyer: Array.from({ length: MAX_DEALS + 5 }, (_, i) => s(i + 1, "2025-01-01")) } }], "2023-11-09");
ok("pick: capped", lots.picked.length === MAX_DEALS && lots.dropped === 5);
const info = {
  timeline: [{ status: "Announced", date: "2025-02-03" }, { status: "Closed", date: "2025-07-01" }],
  participants: {
    target: { company_name: "Example Specialty Holdings", advisors: [{ advisor_company_name: "Goldman Sachs & Co. LLC", advisor_type_name: "Financial Advisor" }, { advisor_company_name: "Kirkland & Ellis LLP", advisor_type_name: "Legal Advisor" }] },
    buyers: [{ company_name: "Sample Insurance Group", advisors: [{ advisor_company_name: "Keefe, Bruyette & Woods, Inc.", advisor_type_name: "Financial Advisor" }] }],
    sellers: [{ company_name: "Illustrative Capital Fund", advisors: [{ advisor_company_name: "Evercore Group L.L.C.", advisor_type_name: "Financial Advisor" }] }],
  },
  consideration: { currency_name: "US Dollar", presentation_gross_total_transaction_value: "1250000000.000000" },
};
const d = toDeal("9", info, s(9, "2025-02-01"), ["AAA"]);
ok("deal: dates, parties, value in $M", d.announced === "2025-02-03" && d.closed === "2025-07-01" && d.target === "Example Specialty Holdings" && d.buyers[0] === "Sample Insurance Group" && d.valueM === 1250 && d.currency === "US Dollar", d);
ok("deal: buyers' advisors buy-side; target's and sellers' sell-side", JSON.stringify(d.advisors.map((a: any) => a.side + ":" + a.name.split(" ")[0] + ":" + a.client.split(" ")[0])) ===
  '["buy:Keefe,:Sample","sell:Goldman:Example","sell:Kirkland:Example","sell:Evercore:Illustrative"]', d.advisors);
ok("deal: no value disclosed", toDeal("8", { ...info, consideration: { currency_name: "US Dollar", presentation_gross_total_transaction_value: null } }, s(8, "2025-01-01"), []).valueM === null);

// ---- fake Kensho
const log: { path: string; body?: any }[] = [];
let mergersFail = "";
const kensho = (async (input: string, init: any = {}) => {
  const url = String(input);
  if (url.endsWith("/oauth2/refresh")) return J({ access_token: "at" });
  const body = init.body ? JSON.parse(init.body) : undefined, path = url.split("/api/v1/")[1] ?? "";
  log.push({ path, body });
  if (path === "ids") return J({ data: Object.fromEntries(body.identifiers.map((t: string) => [t, t === "NOPE" ? { error: "No identification triple found" } : { company_id: t === "AAA" ? 11 : 22, company_name: t === "AAA" ? "Alpha Example Corp" : "Beta Sample Ltd" }])) });
  if (path.startsWith("mergers/info")) return J({ results: Object.fromEntries(body.transaction_ids.map((id: number) => [String(id), id === 103 ? { error: "No merger found" } : info])) });
  if (path.startsWith("mergers/")) {
    const cid = path.split("/")[1];
    if (cid === mergersFail) return J({ detail: "boom" }, 500);
    return J(cid === "11" ? { buyer: [s(101, "2025-02-01"), s(102, "2024-05-01")], seller: [], target: [] } : { buyer: [], seller: [s(101, "2025-02-01"), s(103, "2026-01-10")], target: [] });
  }
  return J({ error: "?" }, 404);
}) as unknown as typeof fetch;
const env = (o: Record<string, string> = {}) => (k: string) => ({ KENSHO_REFRESH_TOKEN: "rt", ...o } as Record<string, string>)[k];
const deps = (o: any = {}) => ({ env: env(), fetch: kensho, now: () => now, whoIs: async () => "ceo", ...o });
const post = (body: unknown) => new Request("https://x/functions/v1/league", { method: "POST", headers: { Authorization: "Bearer u", apikey: "k", Origin: "https://ascot-corpdev.github.io" }, body: JSON.stringify(body) });

ok("not signed in: 401", (await handle(post({ companies: ["AAA"] }), deps({ whoIs: async () => null }))).status === 401);
ok("no Kensho credentials: 503", (await handle(post({ companies: ["AAA"] }), deps({ env: env({ KENSHO_REFRESH_TOKEN: "" }) }))).status === 503);
ok("bad companies: 400", (await handle(post({ companies: [] }), deps())).status === 400);
ok("bad years: 400", (await handle(post({ companies: ["AAA"], years: 9 }), deps())).status === 400);
ok("nothing asked of Kensho yet", log.length === 0);

let r = await handle(post({ companies: ["AAA", "BBB", "NOPE"] }), deps());
let b = await r.json();
ok("answers 200 with the window", r.status === 200 && b.since === "2023-11-09" && b.years === 3 && b.source.includes("Kensho"), b);
ok("asks for each company's deals since the window start", log.filter((l) => l.path.startsWith("mergers/") && !l.path.startsWith("mergers/info")).map((l) => l.path).sort().join() === "mergers/11/2023-11-09/none,mergers/22/2023-11-09/none");
ok("asks for details with advisors, once per deal", (() => { const i = log.filter((l) => l.path === "mergers/info"); return i.length === 1 && i[0].body.include_advisors === true && JSON.stringify(i[0].body.transaction_ids.sort()) === "[101,102,103]"; })(), log);
ok("deals: shared deal once with both companies; unknown deal left out", b.deals.length === 2 && JSON.stringify(b.deals.find((x: any) => x.id === "101").via) === '["AAA","BBB"]', b.deals);
ok("companies with their deal counts; unknown ticker in errors", JSON.stringify(b.companies) === '[{"ticker":"AAA","name":"Alpha Example Corp","deals":2},{"ticker":"BBB","name":"Beta Sample Ltd","deals":1}]' && b.errors.NOPE, b);
ok("CORS for the site", r.headers.get("Access-Control-Allow-Origin") === "*");

const n0 = log.length;
r = await handle(post({ companies: ["BBB", "AAA", "NOPE"] }), deps());
ok("same request within 6 hours: from memory", r.status === 200 && log.length === n0);
const rows: { id: string; doc: any }[] = [];
r = await handle(post({ companies: ["BBB", "AAA", "NOPE"], refresh: true }), deps({ store: async (id: string, doc: any) => { rows.push({ id, doc }); return true; } }));
b = await r.json();
ok("refresh: asks Kensho again and saves league:3", log.length > n0 && b.saved === true && rows.length === 1 && rows[0].id === "league:3" && rows[0].doc.deals.length === 2 && JSON.stringify(rows[0].doc.tickers) === '["BBB","AAA","NOPE"]', rows.map((x) => x.id));
ok("no store configured: still answers, saved false", (await (await handle(post({ companies: ["AAA"], refresh: true }), deps())).json()).saved === false);

mergersFail = "22";
r = await handle(post({ companies: ["AAA", "BBB"], years: 2 }), deps());
b = await r.json();
ok("one company's list failing doesn't stop the rest", r.status === 200 && b.errors.BBB && b.deals.length >= 1, b);

console.log(`${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
