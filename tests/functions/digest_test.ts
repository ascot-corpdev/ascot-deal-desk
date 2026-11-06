// Runs the real supabase/functions/digest code under Deno with a fake database and a fake Resend.
(globalThis as any).__DIGEST_TEST__ = true;
const { handle } = await import(new URL("../../supabase/functions/digest/index.ts", import.meta.url).href);
const { buildDigest } = await import(new URL("../../supabase/functions/digest/core.ts", import.meta.url).href);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL " + n, JSON.stringify(x)); } };
const DAY = 86_400_000, now = Date.parse("2026-11-09T07:17:00Z"), iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const deals = [
  { id: "d1", doc: { codename: "Harbor", stage: "LOI", nextStep: "Send LOI", nextStepDate: iso(now - 3 * DAY), updatedAt: now - 2 * DAY, ev: 300 } },
  { id: "d2", doc: { codename: "Quay", stage: "IOI", nextStep: "Mgmt call", nextStepDate: iso(now + 2 * DAY), updatedAt: now - 1 * DAY, ev: 6.5 } },
  { id: "d3", doc: { codename: "Pier", stage: "Screening", updatedAt: now - 45 * DAY, createdAt: now - 60 * DAY, ev: 20 } },
  { id: "d4", doc: { codename: "Jetty", stage: "Diligence", updatedAt: now - 45 * DAY, ev: 100 } },        // quiet record but a recent note
  { id: "d5", doc: { codename: "Ember", stage: "Dead", updatedAt: now - 90 * DAY } },
  { id: "d6", doc: { codename: "Cove", stage: "Signed", nextStepDate: iso(now - 30 * DAY), updatedAt: now - 90 * DAY } },  // Signed = Closed: not active
];
const bankers = [
  { id: "b1", doc: { name: "Ann Lee", firm: "Marsh", lastContact: iso(now - 120 * DAY) } },
  { id: "b2", doc: { name: "Lou Medway", firm: "Aon", lastContact: iso(now - 10 * DAY) } },
  { id: "b3", doc: { name: "Cy <Dee>", firm: "", lastContact: "" } },
];
const notes = [{ id: "n1", doc: { dealId: "d4", text: "QoE call", createdAt: now - 3 * DAY } }];
const history = [
  { tbl: "deals", record_id: "d1", op: "update", changes: { stage: { from: "IOI", to: "LOI" } }, changed_at: new Date(now - 2 * DAY).toISOString() },
  { tbl: "deals", record_id: "d1", op: "update", changes: { stage: { from: "IOI", to: "LOI" } }, changed_at: new Date(now - 20 * DAY).toISOString() },
  { tbl: "deals", record_id: "dz", op: "delete", changes: { doc: { codename: "Zulu" } }, changed_at: new Date(now - 1 * DAY).toISOString() },
];

function fakeDb(opts: { noHistory?: boolean; failDeals?: boolean } = {}) {
  const tables: Record<string, any[]> = { deals, bankers, notes, history };
  return { from(t: string) {
    const st: any = { gte: null };
    const q: any = {
      select() { return q; }, gte(c: string, v: string) { st.gte = [c, v]; return q; }, order() { return q; }, limit() { return q; },
      then(res: any) {
        if (t === "history" && opts.noHistory) return res({ data: null, error: { message: "Could not find the table 'public.history'" } });
        if (t === "deals" && opts.failDeals) return res({ data: null, error: { message: "boom" } });
        let rows = tables[t];
        if (st.gte) rows = rows.filter((r: any) => String(r[st.gte[0]]) >= st.gte[1]);
        return res({ data: rows, error: null });
      } };
    return q;
  } } as any;
}
const SECRET = "s3cret-s3cret-s3cret-s3cret";
const env = (extra: Record<string, string> = {}) => (k: string) => ({ DIGEST_SECRET: SECRET, RESEND_API_KEY: "re_test", DIGEST_FROM: "Deal desk <dd@ascot.test>", DIGEST_TO: "ceo@ascot.test, cd1@ascot.test", SITE_URL: "https://ascot-corpdev.github.io/ascot-deal-desk/", ...extra } as Record<string, string>)[k];
const req = (headers: Record<string, string> = { "x-digest-secret": SECRET }, url = "https://x/functions/v1/digest", method = "POST") => new Request(url, { method, headers });
let sent: any[] = [];
const fakeFetch = (async (url: string, init: any) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response("{\"id\":\"e1\"}", { status: 200 }); }) as any;

// auth
ok("GET refused", (await handle(req({}, undefined, "GET"), { env: env(), fetch: fakeFetch, db: fakeDb(), now: () => now })).status === 405);
ok("no secret header refused", (await handle(req({}), { env: env(), fetch: fakeFetch, db: fakeDb(), now: () => now })).status === 401);
ok("wrong secret refused", (await handle(req({ "x-digest-secret": SECRET + "x" }), { env: env(), fetch: fakeFetch, db: fakeDb(), now: () => now })).status === 401);
ok("short DIGEST_SECRET refused", (await handle(req(), { env: env({ DIGEST_SECRET: "short" }), fetch: fakeFetch, db: fakeDb(), now: () => now })).status === 500);
ok("nothing sent so far", sent.length === 0);

// dry run
const dry = await (await handle(req(undefined, "https://x/functions/v1/digest?dry=1"), { env: env(), fetch: fakeFetch, db: fakeDb(), now: () => now })).json();
ok("dry run returns digest without sending", dry.dryRun === true && sent.length === 0);
ok("counts", JSON.stringify(dry.counts) === JSON.stringify({ active: 4, overdue: 1, stalled: 1, dueThisWeek: 1, coldBankers: 2, changes: 1 }), dry.counts);
ok("subject", dry.subject === "Deal desk weekly: 4 active deals, 1 overdue, 1 stalled", dry.subject);
ok("text lists items with links", dry.text.includes("- Harbor: Send LOI (due 6 Nov, LOI) https://ascot-corpdev.github.io/ascot-deal-desk/#deal/d1") && dry.text.includes("- Pier (Screening): quiet for 45 days") && dry.text.includes("- 11 Nov: Quay, Mgmt call") && dry.text.includes("Harbor moved IOI to LOI".replace("IOI to LOI","LOI to LOI")) === false, dry.text);
ok("IOI shown as LOI; same-stage alias move not listed", !dry.text.includes("moved LOI to LOI") && !dry.text.includes("IOI"), dry.text);
ok("deleted deal named from history", dry.text.includes("- Zulu deleted"));
ok("Jetty not stalled thanks to a recent note", !dry.text.includes("Jetty (Diligence): quiet"));
ok("Signed counts as closed (not overdue)", !dry.text.includes("Cove"));
ok("html escapes names", dry.html.includes("Cy &lt;Dee&gt;") && !dry.html.includes("Cy <Dee>"));
ok("no em dashes", !dry.text.includes("—") && !dry.html.includes("—"));

// send
const r = await handle(req(), { env: env(), fetch: fakeFetch, db: fakeDb(), now: () => now });
const body = await r.json();
ok("send ok", r.status === 200 && body.sent === true && body.recipients === 2, body);
ok("Resend call", sent.length === 1 && sent[0].url === "https://api.resend.com/emails" && sent[0].auth === "Bearer re_test" && JSON.stringify(sent[0].body.to) === '["ceo@ascot.test","cd1@ascot.test"]' && sent[0].body.from === "Deal desk <dd@ascot.test>" && !!sent[0].body.html && !!sent[0].body.text, sent[0]);

// without history table, the section is dropped and the rest still sends
sent = [];
const nh = await (await handle(req(undefined, "https://x/?dry=1"), { env: env(), fetch: fakeFetch, db: fakeDb({ noHistory: true }), now: () => now })).json();
ok("no history: section omitted", !nh.text.includes("What changed") && nh.counts.changes === 0);
// errors
ok("db error reported", (await handle(req(), { env: env(), fetch: fakeFetch, db: fakeDb({ failDeals: true }), now: () => now })).status === 500);
ok("missing mail settings reported", (await handle(req(), { env: env({ DIGEST_TO: "" }), fetch: fakeFetch, db: fakeDb(), now: () => now })).status === 500);
const badFetch = (async () => new Response("domain not verified", { status: 403 })) as any;
const br = await handle(req(), { env: env(), fetch: badFetch, db: fakeDb(), now: () => now });
ok("Resend failure surfaced", br.status === 502 && (await br.json()).error.includes("domain not verified"));
// empty tracker
const empty = buildDigest({ deals: [], bankers: [], notes: [], history: [], now });
ok("empty tracker", empty.subject === "Deal desk weekly: 0 active deals, nothing overdue or stalled", empty.subject);

await Deno.writeTextFile(new URL("../out/digest_preview.html", import.meta.url), dry.html);
console.log(`${pass} passed, ${fail} failed`); if (fail) Deno.exit(1);
