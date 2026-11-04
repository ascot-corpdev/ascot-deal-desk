-- Change history for deals and bankers: who changed which field, from what, to what, and when.
-- Run once in the Supabase SQL editor after 0001. The page shows the history in each deal or banker drawer
-- and uses it for "What changed" on the CEO view; until this runs, both fall back to the latest updates only.
--
-- Rows are written only by the trigger below (security definer). Logins can read, nobody can edit or delete.

create table if not exists public.history (
  id          bigint generated always as identity primary key,
  tbl         text not null check (tbl in ('deals', 'bankers')),
  record_id   text not null,
  op          text not null check (op in ('insert', 'update', 'delete')),
  changes     jsonb not null default '{}'::jsonb,   -- update: {"field": {"from": .., "to": ..}}; insert/delete: {"doc": ..}
  changed_at  timestamptz not null default now(),
  changed_by  uuid
);
create index if not exists history_record on public.history (tbl, record_id, changed_at desc);
create index if not exists history_time on public.history (changed_at desc);

alter table public.history enable row level security;
drop policy if exists "history: any login reads" on public.history;
create policy "history: any login reads" on public.history
  for select to authenticated using (public.app_role() is not null);
-- No insert/update/delete policies: only the trigger writes.
revoke all on public.history from anon;

create or replace function public.log_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  d jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'INSERT' then
    insert into public.history (tbl, record_id, op, changes, changed_by)
    values (tg_table_name, new.id, 'insert', jsonb_build_object('doc', new.doc), auth.uid());
  elsif tg_op = 'DELETE' then
    insert into public.history (tbl, record_id, op, changes, changed_by)
    values (tg_table_name, old.id, 'delete', jsonb_build_object('doc', old.doc), auth.uid());
  else
    for k in select jsonb_object_keys(coalesce(old.doc, '{}'::jsonb) || coalesce(new.doc, '{}'::jsonb)) loop
      -- bookkeeping fields, not edits
      continue when k in ('updatedAt', 'updatedBy', 'updatedByName', 'stageSince');
      if (old.doc -> k) is distinct from (new.doc -> k) then
        d := d || jsonb_build_object(k, jsonb_build_object('from', old.doc -> k, 'to', new.doc -> k));
      end if;
    end loop;
    if d <> '{}'::jsonb then
      insert into public.history (tbl, record_id, op, changes, changed_by)
      values (tg_table_name, new.id, 'update', d, auth.uid());
    end if;
  end if;
  return null;
end $$;
revoke all on function public.log_change() from public;

drop trigger if exists history_deals on public.deals;
create trigger history_deals after insert or update or delete on public.deals
  for each row execute function public.log_change();
drop trigger if exists history_bankers on public.bankers;
create trigger history_bankers after insert or update or delete on public.bankers
  for each row execute function public.log_change();
