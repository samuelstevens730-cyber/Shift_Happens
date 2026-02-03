-- Employee JWT RLS policies (PIN auth)
-- Uses custom claims: profile_id and store_ids set by employee-auth function.
-- Managers continue to use Supabase Auth (auth.uid()).

alter table public.profiles enable row level security;
alter table public.store_memberships enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_drawer_counts enable row level security;

-- Profiles: manager can read via auth.uid(); employee can read own profile_id from JWT.
drop policy if exists "profiles_select_employee" on public.profiles;
create policy "profiles_select_employee"
on public.profiles
for select
using (
  auth.uid() = id
  or (
    coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
  )::uuid = id
);

-- Store memberships: manager can read via auth.uid(); employee can read only their store_ids.
drop policy if exists "store_memberships_select_employee" on public.store_memberships;
create policy "store_memberships_select_employee"
on public.store_memberships
for select
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
  or (
    (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->'store_ids')::jsonb
      ? store_id::text
  )
);

-- Shifts: manager can read shifts for their stores; employee can read own shifts.
drop policy if exists "shifts_select_employee" on public.shifts;
create policy "shifts_select_employee"
on public.shifts
for select
using (
  exists (
    select 1 from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
  or (
    (
      coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
    )::uuid = profile_id
  )
);

-- Drawer counts: manager can read for their stores; employee can read counts for own shifts.
drop policy if exists "shift_drawer_counts_select_employee" on public.shift_drawer_counts;
create policy "shift_drawer_counts_select_employee"
on public.shift_drawer_counts
for select
using (
  exists (
    select 1
    from public.shifts s
    join public.store_managers mm on mm.store_id = s.store_id
    where s.id = shift_id and mm.user_id = auth.uid()
  )
  or (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
        )::uuid = s.profile_id
    )
  )
);
