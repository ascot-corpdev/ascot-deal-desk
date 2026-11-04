-- Ascot deal desk: schema, roles and row-level security.
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Every signed-in login with a profile can read. Only 'corpdev' logins can write.
-- Logins and roles are managed with scripts/logins.mjs (service role key), never from the browser.

-- ---------- logins ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9._-]{2,40}$'),
  display_name text not null,
  role         text not null check (role in ('ceo', 'corpdev')),
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles: signed-in read" on public.profiles;
create policy "profiles: signed-in read" on public.profiles
  for select to authenticated using (true);
-- No insert/update/delete policies: only the service role (logins script) changes profiles.

create or replace function public.app_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke all on function public.app_role() from public;
grant execute on function public.app_role() to authenticated;

-- ---------- tracker records ----------
-- Each record is a JSON document so the page can evolve fields without migrations.
do $$
declare t text;
begin
  foreach t in array array['deals', 'bankers', 'notes'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id         text primary key check (length(id) between 1 and 64),
        doc        jsonb not null check (jsonb_typeof(doc) = 'object' and pg_column_size(doc) < 262144),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        updated_by uuid default auth.uid()
      );
      alter table public.%1$I enable row level security;

      drop policy if exists "read: any login" on public.%1$I;
      create policy "read: any login" on public.%1$I
        for select to authenticated using (public.app_role() is not null);

      drop policy if exists "insert: corp dev" on public.%1$I;
      create policy "insert: corp dev" on public.%1$I
        for insert to authenticated with check (public.app_role() = 'corpdev');

      drop policy if exists "update: corp dev" on public.%1$I;
      create policy "update: corp dev" on public.%1$I
        for update to authenticated using (public.app_role() = 'corpdev') with check (public.app_role() = 'corpdev');

      drop policy if exists "delete: corp dev" on public.%1$I;
      create policy "delete: corp dev" on public.%1$I
        for delete to authenticated using (public.app_role() = 'corpdev');
    $f$, t);
  end loop;
end $$;

-- Stamp who changed what, server side.
create or replace function public.stamp_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists stamp_deals on public.deals;
create trigger stamp_deals before insert or update on public.deals for each row execute function public.stamp_update();
drop trigger if exists stamp_bankers on public.bankers;
create trigger stamp_bankers before insert or update on public.bankers for each row execute function public.stamp_update();
drop trigger if exists stamp_notes on public.notes;
create trigger stamp_notes before insert or update on public.notes for each row execute function public.stamp_update();

create index if not exists notes_updated_at on public.notes (updated_at desc);

-- Anonymous visitors get nothing.
revoke all on public.deals, public.bankers, public.notes, public.profiles from anon;

-- Live updates in the browser (realtime respects the policies above).
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.deals';   exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.bankers'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.notes';   exception when duplicate_object then null; end;
end $$;
