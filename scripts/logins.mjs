#!/usr/bin/env node
// Manage deal desk logins. Runs on your own machine with the Supabase service role key.
//
//   node scripts/logins.mjs seed                                  create ceo, corpdev1, corpdev2
//   node scripts/logins.mjs add <username> <ceo|corpdev> "<Display name>"
//   node scripts/logins.mjs reset <username>                      new random password
//   node scripts/logins.mjs remove <username>
//   node scripts/logins.mjs list
//
// Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: USERNAME_DOMAIN (must match web/config.js).
// Passwords are printed once and never stored in plain text.

import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const domain = process.env.USERNAME_DOMAIN || "deal-desk.local";
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (Supabase dashboard > Project settings > API).");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const SEED = [
  { username: "ceo", role: "ceo", name: "CEO" },
  { username: "corpdev1", role: "corpdev", name: "Corp Dev 1" },
  { username: "corpdev2", role: "corpdev", name: "Corp Dev 2" },
];

function password() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const pick = () => Array.from({ length: 6 }, () => a[randomInt(a.length)]).join("");
  return `${pick()}-${pick()}-${pick()}`;
}
const email = (u) => `${u}@${domain}`;
function checkUsername(u) {
  if (!/^[a-z0-9._-]{2,40}$/.test(u || "")) throw new Error(`"${u}" is not a valid username: use 2 to 40 lowercase letters, numbers, dots or dashes.`);
}
async function profileOf(username) {
  const { data, error } = await sb.from("profiles").select("id,username,display_name,role").eq("username", username).maybeSingle();
  if (error) throw error;
  return data;
}

async function add(username, role, name) {
  checkUsername(username);
  if (!["ceo", "corpdev"].includes(role)) throw new Error('Role must be "ceo" or "corpdev".');
  if (await profileOf(username)) return { username, role, name, password: null, note: "already exists (use reset)" };
  const pw = password();
  const { data, error } = await sb.auth.admin.createUser({
    email: email(username), password: pw, email_confirm: true, user_metadata: { username },
  });
  if (error) {
    if (/invalid/i.test(error.message)) throw new Error(`Supabase rejected ${email(username)}: ${error.message}. Set USERNAME_DOMAIN to your company's domain (and the same value in web/config.js), then retry.`);
    throw error;
  }
  const { error: pErr } = await sb.from("profiles").insert({ id: data.user.id, username, display_name: name || username, role });
  if (pErr) { await sb.auth.admin.deleteUser(data.user.id); throw pErr; }
  return { username, role, name: name || username, password: pw };
}

async function reset(username) {
  const p = await profileOf(username);
  if (!p) throw new Error(`No login called "${username}".`);
  const pw = password();
  const { error } = await sb.auth.admin.updateUserById(p.id, { password: pw });
  if (error) throw error;
  return { username, role: p.role, name: p.display_name, password: pw };
}

async function remove(username) {
  const p = await profileOf(username);
  if (!p) throw new Error(`No login called "${username}".`);
  const { error } = await sb.auth.admin.deleteUser(p.id); // the profile row is removed with it
  if (error) throw error;
  console.log(`Removed ${username}. They are signed out the next time their session refreshes (within an hour).`);
}

function show(rows) {
  console.table(rows.map((r) => ({ username: r.username, role: r.role, name: r.name, password: r.password ?? r.note ?? "" })));
  if (rows.some((r) => r.password)) console.log("\nSend each password privately. They can change it after signing in (Change password).");
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "seed") {
    const out = [];
    for (const s of SEED) out.push(await add(s.username, s.role, s.name));
    show(out);
  } else if (cmd === "add") {
    show([await add(args[0], args[1], args[2])]);
  } else if (cmd === "reset") {
    show([await reset(args[0])]);
  } else if (cmd === "remove") {
    await remove(args[0]);
  } else if (cmd === "list") {
    const { data, error } = await sb.from("profiles").select("username,display_name,role,created_at").order("role").order("username");
    if (error) throw error;
    console.table(data.map((p) => ({ username: p.username, name: p.display_name, role: p.role, created: p.created_at.slice(0, 10) })));
  } else {
    console.log("Usage: node scripts/logins.mjs seed | add <username> <ceo|corpdev> \"<Name>\" | reset <username> | remove <username> | list");
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
