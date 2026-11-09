-- Keep the Supabase project from pausing. The free tier pauses a project after about a week with no
-- activity; the "Keep Supabase awake" GitHub workflow calls this once a day with the publishable key.
-- It only returns the time: it reads no table, so anonymous callers learn nothing. Run once; safe to rerun.

create or replace function public.keepalive()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now() $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
