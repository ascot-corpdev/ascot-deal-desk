// Saves a function's Kensho result to public.kensho_store (migration 0007), so pages can open from the last fetch
// without asking Kensho. Writes with the project's service role key, which Supabase gives every Edge Function
// (SUPABASE_SERVICE_ROLE_KEY, or the first key in SUPABASE_SECRET_KEYS on projects using the new API keys).
// Logins can only read the table. Returns whether the row was saved; a failed save never fails the request.

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

type Env = (k: string) => string | undefined;
export type Store = (id: string, doc: Record<string, unknown>) => Promise<boolean>;

export function serviceKey(env: Env): string | undefined {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    const first = keys.default ?? Object.values(keys)[0];
    return typeof first === "string" && first ? first : undefined;
  } catch { return undefined; }
}

export function makeStore(env: Env): Store {
  return async (id, doc) => {
    const url = env("SUPABASE_URL"), key = serviceKey(env);
    if (!url || !key) return false;
    try {
      const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await sb.from("kensho_store").upsert({ id, doc, fetched_at: new Date().toISOString() }, { onConflict: "id" });
      return !error;
    } catch { return false; }
  };
}
