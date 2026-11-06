// Runs supabase/functions/comps-chat under Deno against fake Kensho and Anthropic APIs (nothing is billed).
(globalThis as any).__COMPS_CHAT_TEST__ = true;
const { handle } = await import(new URL("../../supabase/functions/comps-chat/index.ts", import.meta.url).href);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL " + n, JSON.stringify(x)); } };
const now = Date.parse("2026-11-06T12:00:00Z");
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const li = (o: Record<string, number>) => Object.entries(o).map(([name, v]) => ({ name, value: String(v) }));
const q = (end: string, prem: number, opex: number, ni: number) => ({ period_end_date: end, num_months: 3, statements: [{ name: "Income Statement",
  line_items: li({ "Premiums and Annuity Revenues": prem, "Policy Benefits": prem * 0.62, "Total Operating Expenses - (Template Specific)": opex, "Net Income - (IS)": ni }) }] });

// ---- fake Kensho (W. R. Berkley-shaped figures; NOPE is unknown)
const kLog: string[] = [];
const kensho = (async (input: string, init: any = {}) => {
  const url = String(input); kLog.push(url.replace("https://kfinance.kensho.com", ""));
  if (url.endsWith("/oauth2/refresh")) return J({ access_token: "at" });
  const body = init.body ? JSON.parse(init.body) : undefined, path = url.split("/api/v1/")[1] ?? "";
  if (path === "ids") return J({ data: Object.fromEntries(body.identifiers.map((t: string) => [t, t === "NOPE" ? { error: "No identification triple found" } : { company_id: t === "WRB" ? 1 : 2, company_name: t === "WRB" ? "W. R. Berkley Corporation" : "HCI Group" }])) });
  if (path === "statements/") {
    const inc = body.statement_type === "income_statement";
    const periods: Record<string, unknown> = {};
    const ends = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].slice(-(body.num_periods ?? 5));
    ends.forEach((e, i) => { periods[`FY${e.slice(0, 4)}Q${Math.ceil(+e.slice(5, 7) / 3)}`] = inc ? q(e, 3_000_000_000 + i * 50_000_000, 2_900_000_000, 400_000_000) :
      { period_end_date: e, num_months: 0, statements: [{ name: "Balance Sheet", line_items: li({ "Total Assets": 45_000_000_000, "Total Liabilities - (Template Specific)": 35_500_000_000 }) }] }; });
    return J({ results: Object.fromEntries(body.company_ids.map((c: number) => [String(c), { currency: "USD", periods }])) });
  }
  if (path.startsWith("market_cap/")) return J({ currency: "USD", market_caps: [{ date: "2025-09-30", market_cap: null, shares_outstanding: "400000000" }, { date: "2026-09-30", market_cap: null, shares_outstanding: "390000000" }, { date: "2026-11-05", market_cap: "29000000000" }] });
  if (path.startsWith("earnings/")) return J({ earnings: [] });
  return J({ error: "?" }, 404);
}) as unknown as typeof fetch;

// ---- fake Anthropic: replies from a script, records each request
let script: unknown[] = []; const aReqs: { body: any; headers: Headers }[] = [];
const anthropic = (async (input: string | Request, init: any = {}) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  aReqs.push({ body: JSON.parse(await req.text()), headers: req.headers });
  const next = script.shift() as any;
  if (next?.status) return J({ type: "error", error: { type: next.type, message: next.message } }, next.status);
  return J({ id: "msg_" + aReqs.length, type: "message", role: "assistant", model: "claude-opus-5-5", stop_details: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, ...next });
}) as unknown as typeof fetch;

const env = (o: Record<string, string> = {}) => (k: string) => ({ ANTHROPIC_API_KEY: "sk-test", KENSHO_REFRESH_TOKEN: "rt", ...o } as Record<string, string>)[k];
const deps = (o: any = {}) => ({ env: env(), fetch: kensho, anthropicFetch: anthropic, now: () => now, whoIs: async () => "ceo", ...o });
const screen = { period: "quarter", asOf: "2026-11-06T12:00:00Z", companies: [{ ticker: "WRB", name: "W. R. Berkley Corporation", quarter: "Q3 2026", combinedRatio: 93.8 }], medians: { combinedRatio: 93.8 } };
const post = (body: unknown) => new Request("https://x/functions/v1/comps-chat", { method: "POST", headers: { Authorization: "Bearer u", apikey: "k", Origin: "https://ascot-corpdev.github.io" }, body: JSON.stringify(body) });
const ask = (text: string, extra: unknown[] = []) => post({ messages: [...extra, { role: "user", text }], screen });

// ---- refusals before anything is spent
ok("not signed in: 401", (await handle(ask("hi"), deps({ whoIs: async () => null }))).status === 401);
const nk = await handle(ask("hi"), deps({ env: env({ ANTHROPIC_API_KEY: "" }) }));
ok("no Anthropic key: 503 with a reason", nk.status === 503 && (await nk.json()).message.includes("ANTHROPIC_API_KEY"));
ok("no Kensho credentials: 503", (await handle(ask("hi"), deps({ env: env({ KENSHO_REFRESH_TOKEN: "" }) }))).status === 503);
ok("conversation must end with a question", (await handle(post({ messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }], screen }), deps())).status === 400);
ok("over-long message refused", (await handle(ask("x".repeat(4001)), deps())).status === 400);
ok("too many turns refused", (await handle(post({ messages: Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "q" })), screen }), deps())).status === 400);
ok("OPTIONS answers with CORS", (await handle(new Request("https://x", { method: "OPTIONS", headers: { Origin: "https://ascot-corpdev.github.io" } }), deps({ env: env({ ALLOWED_ORIGIN: "https://ascot-corpdev.github.io/ascot-deal-desk/" }) }))).headers.get("Access-Control-Allow-Origin") === "https://ascot-corpdev.github.io");
ok("nothing sent to Anthropic yet", aReqs.length === 0);

// ---- a question that needs two lookups, then an answer
const thinking = { type: "thinking", thinking: "", signature: "sig-1" };
script = [
  { content: [thinking, { type: "text", text: "Checking." },
    { type: "tool_use", id: "tu1", name: "get_statement", input: { ticker: "WRB", statement: "income_statement", series: "quarterly", periods: 4 } },
    { type: "tool_use", id: "tu2", name: "get_comps", input: { tickers: ["WRB", "HCI", "NOPE"], period: "ltm" } }], stop_reason: "tool_use" },
  { content: [{ type: "text", text: "**Combined ratio** improved over the last four quarters (derived)." }], stop_reason: "end_turn" },
];
let r = await handle(ask("How has WRB's combined ratio moved, and how does HCI compare?", [{ role: "user", text: "Earlier question" }, { role: "assistant", text: "Earlier answer" }]), deps());
let b = await r.json();
ok("200 with Claude's answer", r.status === 200 && b.text.startsWith("**Combined ratio** improved"), b);
ok("lookups listed for the page", JSON.stringify(b.lookups) === JSON.stringify([{ tool: "get_statement", detail: "WRB income statement, 4 quarterly" }, { tool: "get_comps", detail: "WRB, HCI, NOPE (ltm)" }]), b.lookups);
const r1 = aReqs[0].body, r2 = aReqs[1].body;
ok("model, effort, fallback", r1.model === "claude-opus-5-5" && r1.output_config?.effort === "medium" && r1.fallbacks === "default" && (aReqs[0].headers.get("anthropic-beta") || "").includes("server-side-fallback-2026-07-01"), [r1.model, r1.output_config, r1.fallbacks, aReqs[0].headers.get("anthropic-beta")]);
ok("no thinking override, no forced tool", r1.thinking === undefined && r1.tool_choice === undefined);
ok("two strict tools", r1.tools.map((t: any) => t.name + ":" + t.strict).join(",") === "get_comps:true,get_statement:true");
ok("system prompt: Kensho only, no tracker", r1.system.includes("Use only S&P Global Capital IQ data from Kensho") && r1.system.includes("no access to Ascot's deal tracker"));
ok("first turn carries the table on screen", r1.messages[0].content[0].text.startsWith("Comps table on screen") && r1.messages[0].content[0].text.includes("\"combinedRatio\":93.8") && r1.messages[0].content[1].text === "Earlier question");
ok("earlier answer sent as plain text, new question last", r1.messages[1].role === "assistant" && r1.messages[1].content === "Earlier answer" && r1.messages[2].content === "How has WRB's combined ratio moved, and how does HCI compare?");
ok("Claude's turn sent back unchanged (thinking included)", JSON.stringify(r2.messages[3]) === JSON.stringify({ role: "assistant", content: script.length === 0 ? [thinking, { type: "text", text: "Checking." }, { type: "tool_use", id: "tu1", name: "get_statement", input: { ticker: "WRB", statement: "income_statement", series: "quarterly", periods: 4 } }, { type: "tool_use", id: "tu2", name: "get_comps", input: { tickers: ["WRB", "HCI", "NOPE"], period: "ltm" } }] : [] }), r2.messages[3]);
const results = r2.messages[4];
ok("both results in one user message, in order", results.role === "user" && results.content.length === 2 && results.content[0].tool_use_id === "tu1" && results.content[1].tool_use_id === "tu2");
const st = JSON.parse(results.content[0].content), cp = JSON.parse(results.content[1].content);
ok("statement: four quarters in $M with every line item", st.ticker === "WRB" && st.periods.length === 4 && st.periods[3].period === "FY2026Q3" && st.periods[3].items["Premiums and Annuity Revenues"] === 3150 && st.units.startsWith("millions"), st.periods?.[3]);
ok("comps: same maths as the table (LTM), unknown ticker reported", cp.period === "ltm" && cp.companies.length === 2 && cp.companies[0].combinedRatio !== undefined && cp.errors.NOPE?.startsWith("No identification") && cp.source === "S&P Global Capital IQ via Kensho", cp);

// ---- a bad tool input is reported to Claude, not run
script = [
  { content: [{ type: "tool_use", id: "tu3", name: "get_statement", input: { ticker: "bad ticker!", statement: "income_statement", series: "quarterly", periods: 4 } }], stop_reason: "tool_use" },
  { content: [{ type: "text", text: "I couldn't find that ticker." }], stop_reason: "end_turn" },
];
aReqs.length = 0; r = await handle(ask("And bad ticker!?"), deps()); b = await r.json();
const bad = aReqs[1].body.messages.at(-1).content[0];
ok("invalid ticker: error result, no Kensho call, answer continues", bad.is_error === true && JSON.parse(bad.content).error.startsWith("Give a ticker") && b.text === "I couldn't find that ticker." && b.lookups.length === 0, bad);

// ---- refusal, cut-off, Anthropic errors, runaway loops
script = [{ content: [], stop_reason: "refusal" }];
b = await (await handle(ask("x"), deps())).json();
ok("refusal: a plain message", b.text === "Claude declined this question. Try rephrasing it.");
script = [{ content: [{ type: "text", text: "Partial" }], stop_reason: "max_tokens" }];
b = await (await handle(ask("x"), deps())).json();
ok("cut off: says so", b.text.startsWith("Partial") && b.text.includes("cut short"));
script = [{ status: 429, type: "rate_limit_error", message: "slow down" }, { status: 429, type: "rate_limit_error", message: "slow down" }, { status: 429, type: "rate_limit_error", message: "slow down" }];
r = await handle(ask("x"), deps()); b = await r.json();
ok("rate limited: 429 with a reason", r.status === 429 && b.message.includes("busy"), [r.status, b]);
script = [{ status: 401, type: "authentication_error", message: "bad key" }];
r = await handle(ask("x"), deps()); b = await r.json();
ok("bad key: 503 says so", r.status === 503 && b.message.includes("API key"), b);
script = Array.from({ length: 9 }, (_, i) => ({ content: [{ type: "tool_use", id: "loop" + i, name: "get_statement", input: { ticker: "WRB", statement: "balance_sheet", series: "annual", periods: 2 } }], stop_reason: "tool_use" }));
aReqs.length = 0; b = await (await handle(ask("loop"), deps())).json();
ok("stops after 8 rounds", aReqs.length === 8 && b.text.includes("more lookups than one question allows"), [aReqs.length, b.text]);

console.log(`${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
