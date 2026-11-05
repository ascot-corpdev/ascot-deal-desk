-- Shared settings for the site, one JSON document per key. Today: the Benchmarking peer list and the
-- AGL financials link ("benchmark"). Only the link is kept; AGL's financials themselves are not stored.
-- Same rules as the tracker: every login reads, only Corp Dev logins write. Run once after 0001.

create table if not exists public.settings (
  id         text primary key check (length(id) between 1 and 64),
  doc        jsonb not null check (jsonb_typeof(doc) = 'object' and pg_column_size(doc) < 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.settings enable row level security;

drop policy if exists "read: any login" on public.settings;
create policy "read: any login" on public.settings
  for select to authenticated using (public.app_role() is not null);
drop policy if exists "insert: corp dev" on public.settings;
create policy "insert: corp dev" on public.settings
  for insert to authenticated with check (public.app_role() = 'corpdev');
drop policy if exists "update: corp dev" on public.settings;
create policy "update: corp dev" on public.settings
  for update to authenticated using (public.app_role() = 'corpdev') with check (public.app_role() = 'corpdev');
-- No delete policy: settings are edited, not removed.

drop trigger if exists stamp_settings on public.settings;
create trigger stamp_settings before insert or update on public.settings for each row execute function public.stamp_update();

revoke all on public.settings from anon;
