create table if not exists public.riji_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.riji_snapshots enable row level security;

grant select, insert, update, delete on public.riji_snapshots to authenticated;
revoke all on public.riji_snapshots from anon;

drop policy if exists "Users can read their own Riji data" on public.riji_snapshots;
create policy "Users can read their own Riji data"
on public.riji_snapshots for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own Riji data" on public.riji_snapshots;
create policy "Users can create their own Riji data"
on public.riji_snapshots for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Riji data" on public.riji_snapshots;
create policy "Users can update their own Riji data"
on public.riji_snapshots for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own Riji data" on public.riji_snapshots;
create policy "Users can delete their own Riji data"
on public.riji_snapshots for delete to authenticated
using ((select auth.uid()) = user_id);

