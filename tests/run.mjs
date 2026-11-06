// Runs every test suite and prints one summary. Exit code 1 if anything fails.
//   npm test              all suites
//   npm test -- comps qa  only suites whose file name contains "comps" or "qa"
// Web suites (tests/web/*.test.cjs) drive web/index.html in Chromium against an in-memory Supabase stand-in
// (tests/web/mock-supabase.js); nothing touches the live database. Function suites (tests/functions/*.ts) run the
// Supabase Edge Functions under Deno against fake Kensho and Resend APIs; they are skipped if Deno isn't installed.
// Screenshots, board packs and calendar files land in tests/out/ (not committed).
import { spawnSync } from "node:child_process";
import { readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, "out"), { recursive: true });
const only = process.argv.slice(2);
const pick = (f) => !only.length || only.some((o) => f.includes(o));
const deno = process.env.DENO_BIN || "deno";
const hasDeno = spawnSync(deno, ["--version"], { stdio: "ignore" }).status === 0;

const suites = [
  ...readdirSync(join(here, "functions")).filter((f) => f.endsWith(".ts")).filter(pick).map((f) => ({ name: "functions/" + f, cmd: deno, args: ["run", "-A", "--node-modules-dir=none", join(here, "functions", f)], deno: true })),
  ...readdirSync(join(here, "web")).filter((f) => f.endsWith(".test.cjs")).filter(pick).map((f) => ({ name: "web/" + f, cmd: process.execPath, args: [join(here, "web", f)] })),
];

let failed = 0, passed = 0;
const rows = [];
for (const s of suites) {
  if (s.deno && !hasDeno) { rows.push([s.name, "skipped (Deno not installed)"]); continue; }
  // Browser suites wait on timers, so a slow machine can trip one; run a failing suite a second time before reporting it.
  let r, tries = 0;
  do { r = spawnSync(s.cmd, s.args, { encoding: "utf8", cwd: join(here, ".."), timeout: 10 * 60_000 }); tries++; }
  while (r.status !== 0 && tries < 2 && !s.deno);
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/g);
  const last = m ? m[m.length - 1].match(/(\d+) passed, (\d+) failed/) : null;
  passed += last ? +last[1] : 0;
  if (r.status !== 0) {
    failed++;
    rows.push([s.name, `FAILED${last ? ` (${last[1]} passed, ${last[2]} failed)` : ""}`]);
    console.log(`\n--- ${s.name} ---\n` + out.split("\n").filter((l) => /FAIL|Error|error|at /.test(l)).slice(0, 40).join("\n"));
  } else rows.push([s.name, `ok, ${last ? last[1] : "?"} checks${tries > 1 ? " (passed on retry)" : ""}`]);
}
const w = Math.max(...rows.map((r) => r[0].length));
console.log("\n" + rows.map(([n, v]) => n.padEnd(w + 2) + v).join("\n"));
console.log(`\n${passed} checks passed; ${failed} suite${failed === 1 ? "" : "s"} failed.`);
process.exit(failed ? 1 : 0);
