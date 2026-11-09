// Backup and restore scripts: encryption, where files may go, reading and writing tables (against a fake Supabase).
import { encrypt, decrypt, checkOutDir, dump, restore, counts, REPO_ROOT, DEFAULT_DIR, TABLES, RESTORE_TABLES } from "../../scripts/backup-lib.mjs";
import { spawnSync, spawn } from "node:child_process";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log("FAIL " + n + "  " + JSON.stringify(x)); } };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

// ---- encryption
const data = { project: "https://x.supabase.co", tables: { deals: [{ id: "d1", doc: { codename: "Project Example", ev: 100 } }] } };
const file = encrypt(data, "correct horse battery");
const f = JSON.parse(file);
ok("file format: AES-256-GCM fields, scrypt settings", f.format === "ascot-deal-desk-backup" && f.v === 1 && f.kdf === "scrypt" && f.N === 131072 && f.salt && f.iv && f.tag && f.data);
ok("no readable data in the file", !file.includes("Project Example") && !file.includes("codename"));
ok("round trip", JSON.stringify(decrypt(file, "correct horse battery")) === JSON.stringify(data));
ok("fresh salt and IV each time", JSON.parse(encrypt(data, "correct horse battery")).salt !== f.salt);
ok("wrong passphrase refused", throws(() => decrypt(file, "wrong passphrase!!")) === "Wrong passphrase, or the file has been changed.");
const tampered = JSON.stringify({ ...f, data: Buffer.from("x" + Buffer.from(f.data, "base64").toString("latin1").slice(1), "latin1").toString("base64") });
ok("changed file refused", throws(() => decrypt(tampered, "correct horse battery")) === "Wrong passphrase, or the file has been changed.");
ok("not a backup refused", throws(() => decrypt("{\"a\":1}", "x")).startsWith("This isn't a deal desk backup file") && throws(() => decrypt("garbage", "x")).startsWith("This isn't"));

// ---- where backups may go
ok("default folder is in Documents, outside the repo", DEFAULT_DIR === join(homedir(), "Documents", "ascot-deal-desk-backups") && checkOutDir(DEFAULT_DIR) === DEFAULT_DIR);
ok("repo folder refused", (throws(() => checkOutDir(REPO_ROOT)) || "").includes("can't go inside the repository folder"));
ok("folder inside the repo refused", (throws(() => checkOutDir(join(REPO_ROOT, "backups"))) || "").includes("can't go inside") && (throws(() => checkOutDir(join(REPO_ROOT, "web", "x"))) || "").includes("can't go inside"));
ok("sibling folder with a similar name allowed", checkOutDir(REPO_ROOT + "-backups") === REPO_ROOT + "-backups");

// ---- fake Supabase
function fakeSb(rowsByTable, { missing = [], failOn = null, upsertFail = null } = {}) {
  const log = [];
  return { log, from(t) {
    const q = { _t: t,
      select() { return q; }, order() { return q; },
      range(a, b) { log.push(["range", t, a, b]);
        if (missing.includes(t)) return Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table in the schema cache" } });
        if (failOn === t) return Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } });
        return Promise.resolve({ data: (rowsByTable[t] || []).slice(a, b + 1), error: null }); },
      upsert(rows, opt) { log.push(["upsert", t, rows.length, opt.onConflict]); return Promise.resolve({ error: upsertFail === t ? { message: "violates foreign key" } : null }); } };
    return q; } };
}
const many = Array.from({ length: 2500 }, (_, i) => ({ id: "n" + i }));
let sb = fakeSb({ deals: [{ id: "d1" }], bankers: [{ id: "b1" }], notes: many, profiles: [{ id: "u1" }] }, { missing: ["history", "settings"] });
const d = await dump(sb);
ok("dump: every table, paged 1,000 at a time", d.tables.notes.length === 2500 && sb.log.filter((l) => l[1] === "notes").length === 3 && d.tables.deals.length === 1);
ok("dump: tables not set up yet are skipped and named", JSON.stringify(d.skipped) === '["history","settings"]' && !("history" in d.tables));
ok("counts", JSON.stringify(counts(d.tables)) === '{"profiles":1,"deals":1,"bankers":1,"notes":2500}');
let err = null; try { await dump(fakeSb({}, { failOn: "deals" })); } catch (e) { err = e.message; }
ok("dump: a real error stops the backup", err === "Couldn't read deals: permission denied", err);

sb = fakeSb({});
const r = await restore(sb, { ...d.tables, history: [{ id: 1 }], settings: [{ id: "benchmark" }] });
ok("restore: upserts by id in 500s, profiles first", JSON.stringify(sb.log.filter((l) => l[0] === "upsert").map((l) => l[1] + ":" + l[2])) === JSON.stringify(["profiles:1", "deals:1", "bankers:1", "notes:500", "notes:500", "notes:500", "notes:500", "notes:500", "settings:1"]) && sb.log.every((l) => l[0] !== "upsert" || l[3] === "id"));
ok("restore: history kept in the file, not written back", !sb.log.some((l) => l[1] === "history") && !RESTORE_TABLES.includes("history") && TABLES.includes("history"));
ok("restore: counts", r.done.notes === 2500 && Object.keys(r.errors).length === 0);
const r2 = await restore(fakeSb({}, { upsertFail: "profiles" }), d.tables);
ok("restore: a table error is reported, others still run", r2.errors.profiles === "violates foreign key" && r2.done.deals === 1);

// ---- the commands themselves (no network: they stop before connecting)
const run = (script, args, env) => spawnSync(process.execPath, [join(REPO_ROOT, "scripts", script), ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, input: "" });
let o = run("backup.mjs", [], {});
ok("backup without keys explains", o.status === 1 && o.stderr.includes("Set SUPABASE_URL and SUPABASE_SECRET_KEY"));
o = run("backup.mjs", ["--out", join(REPO_ROOT, "backups")], { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" });
ok("backup into the repo refused before connecting", o.status === 1 && o.stderr.includes("can't go inside the repository folder"), o.stderr);
o = run("restore.mjs", [], {});
ok("restore without a file shows usage", o.status === 1 && o.stderr.includes("Usage: npm run restore -- <backup file>"));
o = run("restore.mjs", [join(tmpdir(), "no-such-backup.enc")], { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" });
ok("restore of a missing file explains", o.status === 1 && o.stderr.includes("Can't read"));

// ---- end to end: npm run backup, then npm run restore, against a local stand-in for Supabase's REST API
import http from "node:http";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
const store = { profiles: [{ id: "u1", username: "ceo", role: "ceo" }], deals: [{ id: "d1", doc: { codename: "Project Example" } }], bankers: [], notes: [{ id: "n1", doc: { text: "hello" } }], settings: [{ id: "benchmark", doc: { peers: ["WRB"] } }] };
const writes = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), t = u.pathname.replace("/rest/v1/", "");
  let body = ""; req.on("data", (c) => body += c); req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.apikey !== "sb_secret_test") { res.statusCode = 401; return res.end('{"message":"bad key"}'); }
    if (req.method === "GET") {
      if (!(t in store)) { res.statusCode = 404; return res.end(JSON.stringify({ code: "PGRST205", message: `Could not find the table 'public.${t}' in the schema cache` })); }
      const off = +(u.searchParams.get("offset") || 0), lim = +(u.searchParams.get("limit") || 1000);
      return res.end(JSON.stringify(store[t].slice(off, off + lim)));
    }
    if (req.method === "POST") { writes.push({ t, rows: JSON.parse(body), conflict: u.searchParams.get("on_conflict"), prefer: req.headers.prefer }); res.statusCode = 201; return res.end("[]"); }
    res.statusCode = 405; res.end("{}");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URLX = `http://127.0.0.1:${server.address().port}`, out = mkdtempSync(join(tmpdir(), "dd-backup-"));
const runAsync = (script, args, input) => new Promise((res) => {
  const p = spawn(process.execPath, [join(REPO_ROOT, "scripts", script), ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_URL: URLX, SUPABASE_SECRET_KEY: "sb_secret_test" } });
  let so = "", se = ""; p.stdout.on("data", (c) => so += c); p.stderr.on("data", (c) => se += c);
  const lines = input.slice(); const feed = setInterval(() => { if (lines.length) p.stdin.write(lines.shift() + "\n"); }, 400);
  p.on("close", (code) => { clearInterval(feed); res({ code, so, se }); });
});
let e2e = await runAsync("backup.mjs", ["--out", out], ["a long passphrase", "a long passphrase"]);
const files = readdirSync(out);
ok("backup: one .enc file, private to the user", e2e.code === 0 && files.length === 1 && /^ascot-deal-desk-\d{4}-\d{2}-\d{2}-\d{4}\.enc$/.test(files[0]) && (statSync(join(out, files[0])).mode & 0o077) === 0, [e2e.code, e2e.se, files]);
ok("backup: lists counts and skipped tables, never echoes the passphrase", e2e.so.includes("deals: 1") && e2e.so.includes("skipped: history") && !e2e.so.includes("a long passphrase"), e2e.so);
const saved = decrypt(readFileSync(join(out, files[0]), "utf8"), "a long passphrase");
ok("backup: file opens with the passphrase and holds the data", saved.tables.deals[0].doc.codename === "Project Example" && saved.project === URLX && saved.counts.notes === 1);
e2e = await runAsync("backup.mjs", ["--out", out], ["short", "short"]);
ok("backup: short passphrase refused", e2e.code === 1 && e2e.se.includes("at least 12 characters"));
e2e = await runAsync("backup.mjs", ["--out", out], ["a long passphrase", "a different one!!"]);
ok("backup: mismatched passphrase refused", e2e.code === 1 && e2e.se.includes("didn't match") && readdirSync(out).length === 1);
e2e = await runAsync("restore.mjs", [join(out, files[0])], ["a long passphrase", "no"]);
ok("restore: shows counts, writes nothing without 'restore'", e2e.code === 0 && e2e.so.includes("deals: 1") && e2e.so.includes("Nothing was changed.") && writes.length === 0, e2e.so);
e2e = await runAsync("restore.mjs", [join(out, files[0])], ["wrong passphrase", ""]);
ok("restore: wrong passphrase refused", e2e.code === 1 && e2e.se.includes("Wrong passphrase"));
e2e = await runAsync("restore.mjs", [join(out, files[0])], ["a long passphrase", "restore"]);
ok("restore: upserts each table by id", e2e.code === 0 && JSON.stringify(writes.map((w) => w.t + ":" + w.rows.length + ":" + w.conflict)) === JSON.stringify(["profiles:1:id", "deals:1:id", "notes:1:id", "settings:1:id"]) && writes.every((w) => (w.prefer || "").includes("merge-duplicates")), [e2e.se, writes.map((w) => [w.t, w.conflict, w.prefer])]);
server.close();

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
