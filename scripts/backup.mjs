#!/usr/bin/env node
// Back up the deal desk to an encrypted file on your own computer. Never commit backups or put them on GitHub.
//
//   npm run backup                      writes to ~/Documents/ascot-deal-desk-backups/
//   npm run backup -- --out <folder>    writes somewhere else (not inside this repository folder)
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY, as for `npm run logins`. Asks for a passphrase (12+ characters,
// typed twice, not shown). Keep the passphrase somewhere safe: without it the backup can't be opened.
// Saves profiles, deals, bankers, notes, history and settings. Logins' passwords are not included (Supabase
// keeps them separately), so after a restore into a new project, recreate logins with `npm run logins`.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { encrypt, dump, counts, checkOutDir, stamp, DEFAULT_DIR } from "./backup-lib.mjs";
import { askHidden } from "./prompt.mjs";

const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY first, as for npm run logins."); process.exit(1); }

const i = process.argv.indexOf("--out");
let dir;
try { dir = checkOutDir(i > -1 && process.argv[i + 1] ? process.argv[i + 1] : DEFAULT_DIR); } catch (e) { console.error(e.message); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
console.log("Reading the tracker…");
const { tables, skipped } = await dump(sb).catch((e) => { console.error(e.message); process.exit(1); });
const c = counts(tables);
console.log(Object.entries(c).map(([t, n]) => `  ${t}: ${n}`).join("\n") + (skipped.length ? `\n  (not set up yet, skipped: ${skipped.join(", ")})` : ""));

const pass = await askHidden("Passphrase for this backup (12+ characters, not shown): ");
if (pass.length < 12) { console.error("Use at least 12 characters."); process.exit(1); }
if (await askHidden("Type it again: ") !== pass) { console.error("The two didn't match. Nothing was saved."); process.exit(1); }

mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = join(dir, `ascot-deal-desk-${stamp()}.enc`);
writeFileSync(file, encrypt({ project: url, createdAt: new Date().toISOString(), counts: c, tables }, pass), { mode: 0o600 });
console.log(`Saved ${file}\nKeep the passphrase safe: the file can't be opened without it.`);
process.exit(0);
