#!/usr/bin/env node
// Restore a backup made by `npm run backup`.
//
//   npm run restore -- <file.enc>
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY for the project to restore into. Asks for the backup's passphrase,
// shows what's in it, and writes only after you type "restore". Rows are upserted by id: records in the backup
// replace the ones with the same id, and records added since the backup are left alone (nothing is deleted).
// The database stamps restored rows as updated now, and the change history records the restore. The history
// table itself is kept in the backup for reference but not written back (it's the audit log).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { decrypt, restore, counts } from "./backup-lib.mjs";
import { ask, askHidden } from "./prompt.mjs";

const file = process.argv[2];
if (!file) { console.error("Usage: npm run restore -- <backup file>"); process.exit(1); }
const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY first, as for npm run logins."); process.exit(1); }

let text;
try { text = readFileSync(file, "utf8"); } catch (e) { console.error(`Can't read ${file}: ${e.message}`); process.exit(1); }
let b;
try { b = decrypt(text, await askHidden("Backup passphrase: ")); } catch (e) { console.error(e.message); process.exit(1); }

console.log(`Backup of ${b.project}, made ${b.createdAt}:`);
console.log(Object.entries(counts(b.tables)).map(([t, n]) => `  ${t}: ${n}`).join("\n"));
if (b.tables.history) console.log("(The change history stays in the file for reference; it isn't written back.)");
if (b.project !== url) console.log(`Note: you're restoring into a different project (${url}).`);
if ((await ask('Type "restore" to write these rows to Supabase: ')).trim() !== "restore") { console.log("Nothing was changed."); process.exit(0); }

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { done, errors } = await restore(sb, b.tables);
console.log("Restored:\n" + Object.entries(done).map(([t, n]) => `  ${t}: ${n}`).join("\n"));
if (Object.keys(errors).length) {
  console.error("Some tables failed:\n" + Object.entries(errors).map(([t, m]) => `  ${t}: ${m}`).join("\n"));
  console.error("(profiles fail if the logins don't exist in this project yet: create them with npm run logins, then restore again.)");
  process.exit(1);
}
process.exit(0);
