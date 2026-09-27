-- Billsplit database setup.
-- Paste this whole file into Supabase → SQL Editor → New query, EDIT THE TWO EMAILS
-- at the bottom, then press Run. It is safe to run more than once.

-- 1. Who is allowed in -------------------------------------------------------
create table if not exists public.members (
  email text primary key
);
alter table public.members enable row level security;
drop policy if exists "members can see members" on public.members;
create policy "members can see members" on public.members
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m where lower(m.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- 2. One table holds every expense, settlement, repeating expense and the shared settings.
create table if not exists public.entries (
  id text primary key,
  kind text not null check (kind in ('expense', 'settlement', 'recurring', 'settings')),
  data jsonb not null,
  deleted boolean not null default false,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists entries_updated_at_idx on public.entries (updated_at);

alter table public.entries enable row level security;
drop policy if exists "members read" on public.entries;
drop policy if exists "members insert" on public.entries;
drop policy if exists "members update" on public.entries;
create policy "members read" on public.entries for select to authenticated using (public.is_member());
create policy "members insert" on public.entries for insert to authenticated with check (public.is_member());
create policy "members update" on public.entries for update to authenticated
  using (public.is_member()) with check (public.is_member());
-- (no delete policy: the app soft-deletes so the other phone learns about deletions)

-- Explicit table access for signed-in users (works whether or not "Automatically expose
-- new tables" was ticked when the project was created). Row-level security above still
-- limits it to the two member emails; logged-out visitors get nothing.
grant usage on schema public to authenticated;
grant select, insert, update on public.entries to authenticated;
revoke all on public.entries from anon;
revoke all on public.members from anon;

-- 3. Server-side timestamps + last-write-wins when both phones edit the same thing offline.
create or replace function public.entries_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.client_updated_at < old.client_updated_at then
    -- An older edit arrived late: keep the newer version, but bump updated_at so the
    -- phone that sent the stale edit pulls the winner back down.
    old.updated_at := clock_timestamp();
    return old;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before insert or update on public.entries
  for each row execute function public.entries_touch();

-- 4. Realtime, so the other phone updates instantly.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
end $$;

-- 5. ✏️  YOUR TWO EMAIL ADDRESSES (the ones you'll create logins for) ---------
insert into public.members (email) values
  ('tom@example.com'),
  ('nuria@example.com')
on conflict do nothing;
