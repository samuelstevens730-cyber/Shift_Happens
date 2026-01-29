-- RLS policies for core tables.
-- NOTE: clock-in currently uses unauthenticated access to list profiles.
-- Tighten the profiles SELECT policy once employee auth is in place.

alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.store_memberships enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_drawer_counts enable row level security;

-- Stores: read for everyone, no writes.
drop policy if exists "stores_select_all" on public.stores;
create policy "stores_select_all"
on public.stores
for select
to anon, authenticated
using (true);

-- Profiles: reset policies to avoid recursion, then allow read for clock-in (temporary) and self once auth_user_id is set.
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy if exists %I on public.profiles', r.policyname);
  end loop;
end $$;

create policy "profiles_select_clock_in"
on public.profiles
for select
to anon, authenticated
using (true);

create policy "profiles_select_self"
on public.profiles
for select
using (auth.uid() = auth_user_id);

-- Store memberships: managers can read for their stores.
drop policy if exists "store_memberships_select_manager" on public.store_memberships;
create policy "store_memberships_select_manager"
on public.store_memberships
for select
using (
  exists (
    select 1 from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
);

-- Shifts: managers can read shifts for their stores, and users can read their own shifts.
drop policy if exists "shifts_select_manager" on public.shifts;
create policy "shifts_select_manager"
on public.shifts
for select
using (
  exists (
    select 1 from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
);

drop policy if exists "shifts_select_self" on public.shifts;
create policy "shifts_select_self"
on public.shifts
for select
using (
  exists (
    select 1 from public.profiles p
    where p.id = profile_id and p.auth_user_id = auth.uid()
  )
);

-- Drawer counts: managers can read for their stores, and users can read their own shifts.
drop policy if exists "shift_drawer_counts_select_manager" on public.shift_drawer_counts;
create policy "shift_drawer_counts_select_manager"
on public.shift_drawer_counts
for select
using (
  exists (
    select 1
    from public.shifts s
    join public.store_managers mm on mm.store_id = s.store_id
    where s.id = shift_id and mm.user_id = auth.uid()
  )
);

drop policy if exists "shift_drawer_counts_select_self" on public.shift_drawer_counts;
create policy "shift_drawer_counts_select_self"
on public.shift_drawer_counts
for select
using (
  exists (
    select 1
    from public.shifts s
    join public.profiles p on p.id = s.profile_id
    where s.id = shift_id and p.auth_user_id = auth.uid()
  )
);
