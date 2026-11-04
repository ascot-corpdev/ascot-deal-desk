// Weekly email digest for the deal desk, sent through Resend (resend.com).
// Called by a Supabase Cron job (see supabase/digest_schedule.sql) with a shared secret header.
// No login is involved, so the function checks that secret itself: deploy with --no-verify-jwt.
//
// Secrets (supabase secrets set ...):
//   DIGEST_SECRET   long random string; the cron job sends it as x-digest-secret
//   RESEND_API_KEY  from resend.com
//   DIGEST_FROM     sender on a domain verified in Resend, e.g. "Deal desk <dealdesk@yourco.com>"
//   DIGEST_TO       comma-separated recipients
//   SITE_URL        optional, the GitHub Pages address, for links in the email
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
//
// POST /functions/v1/digest            sends the digest
// POST /functions/v1/digest?dry=1      returns the digest as JSON without sending (still needs the secret)

import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { buildDigest, type Doc, type HistoryRow } from "./core.ts";

type Env = (k: string) => string | undefined;
type Deps = { env: Env; fetch: typeof fetch; db?: ReturnType<typeof createClient>; now?: () => number };

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const { env } = deps;
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const secret = env("DIGEST_SECRET") ?? "";
  if (secret.length < 24) return json(500, { error: "DIGEST_SECRET is not set (use at least 24 characters)." });
  if (!sameSecret(req.headers.get("x-digest-secret") ?? "", secret)) return json(401, { error: "Not allowed." });

  const db = deps.db ?? createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const load = async (table: string) => {
    const { data, error } = await db.from(table).select("id,doc");
    if (error) throw new Error(`Couldn't read ${table}: ${error.message}`);
    return (data ?? []).map((r: { id: string; doc: Record<string, unknown> }) => ({ ...(r.doc ?? {}), id: r.id }) as Doc);
  };
  const now = deps.now ? deps.now() : Date.now();
  let deals: Doc[], bankers: Doc[], notes: Doc[];
  try { [deals, bankers, notes] = await Promise.all([load("deals"), load("bankers"), load("notes")]); }
  catch (e) { return json(500, { error: (e as Error).message }); }
  // History is optional (migration 0003); without it the "what changed" section is left out.
  const h = await db.from("history").select("tbl,record_id,op,changes,changed_at")
    .gte("changed_at", new Date(now - 7 * 86_400_000).toISOString()).order("changed_at", { ascending: false }).limit(500);
  const history = h.error ? null : (h.data as HistoryRow[]);

  const digest = buildDigest({ deals, bankers, notes, history, now, siteUrl: env("SITE_URL") });
  if (new URL(req.url).searchParams.get("dry") === "1") return json(200, { dryRun: true, ...digest });

  const to = (env("DIGEST_TO") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const from = env("DIGEST_FROM") ?? "", key = env("RESEND_API_KEY") ?? "";
  if (!to.length || !from || !key) return json(500, { error: "Set DIGEST_TO, DIGEST_FROM and RESEND_API_KEY." });

  const res = await deps.fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: digest.subject, html: digest.html, text: digest.text }),
  });
  if (!res.ok) return json(502, { error: `Resend refused the email (${res.status}): ${(await res.text()).slice(0, 300)}` });
  return json(200, { sent: true, recipients: to.length, subject: digest.subject, counts: digest.counts });
}

// Tests import handle() with this flag set; in Supabase the server always starts.
if (!(globalThis as { __DIGEST_TEST__?: boolean }).__DIGEST_TEST__) {
  Deno.serve((req) => handle(req, { env: (k) => Deno.env.get(k), fetch }));
}
