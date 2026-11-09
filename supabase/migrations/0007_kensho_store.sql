-- Saved Kensho results, so the Comps tab, CEO view and league table open at once from the last fetch instead of
-- asking Kensho every time. One row per view: "comps:quarter", "comps:ytd", "comps:ltm", "league:3" and so on.
-- Only the comps and league functions write here (with the service role, after someone clicks Refresh or when
-- nothing is saved yet); every login reads; anonymous visitors get nothing. Run once after 0001.
-- The rows hold S&P Global data: check that Ascot's Kensho / S&P licence allows keeping it.

create table if not exists public.kensho_store (
  id         text primary key check (id ~ '^(comps|league):[a-z0-9]{1,16}$'),
  doc        jsonb not null check (jsonb_typeof(doc) = 'object' and pg_column_size(doc) < 4194304),
  fetched_at timestamptz not null default now()
);
alter table public.kensho_store enable row level security;

drop policy if exists "read: any login" on public.kensho_store;
create policy "read: any login" on public.kensho_store
  for select to authenticated using (public.app_role() is not null);
-- No insert, update or delete policies: logins can't write here; the functions use the service role.

revoke all on public.kensho_store from anon, authenticated;
grant select on public.kensho_store to authenticated;
grant select, insert, update on public.kensho_store to service_role;
