-- Consolidated database schema and functions (ordered)
-- Generated: 2026-02-03 12:20:03

-- ============================================================
-- BEGIN 01_schema.sql
-- ============================================================

-- ============================================================
-- LV Timeclock V1 Schema (QR + Name Select)
-- Drawer counts: START + END for all shifts (except OTHER),
-- and CHANGEOVER required for DOUBLE.
-- ============================================================

create extension if not exists pgcrypto;

-- ----------------------------
-- 1) Types
-- ----------------------------
do $$ begin
  create type public.shift_type as enum ('open','close','double','other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.drawer_count_type as enum ('start','changeover','end');
exception when duplicate_object then null;
end $$;

-- ----------------------------
-- 2) Core tables
-- ----------------------------
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  qr_token text not null unique,
  expected_drawer_cents integer not null default 20000, -- $200.00
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null references auth.users(id) on delete set null,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.store_memberships (
  store_id uuid not null references public.stores(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (store_id, profile_id)
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  profile_id uuid not null references public.profiles(id),
  shift_type public.shift_type not null,

  planned_start_at timestamptz not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  requires_override boolean not null default false,
  override_at timestamptz,
  override_by uuid,
  override_note text,
  manual_closed boolean not null default false,
  manual_closed_at timestamptz,
  manual_closed_by_profile uuid references public.profiles(id) on delete set null,
  manual_closed_review_status text check (manual_closed_review_status in ('approved','edited','removed')),
  manual_closed_reviewed_at timestamptz,
  manual_closed_reviewed_by uuid references auth.users(id) on delete set null,
  last_action text not null default 'added' check (last_action in ('added','edited','removed')),
  last_action_by uuid,

  created_at timestamptz not null default now()
);

create index if not exists shifts_store_id_idx on public.shifts(store_id);
create index if not exists shifts_profile_id_idx on public.shifts(profile_id);
create index if not exists shifts_started_at_idx on public.shifts(started_at);

-- ----------------------------
-- 3) Drawer count events
-- ----------------------------
create table if not exists public.shift_drawer_counts (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  count_type public.drawer_count_type not null,
  counted_at timestamptz not null default now(),

  -- cents to avoid float issues
  drawer_cents integer not null,
  change_count integer,

  -- threshold workflow
  confirmed boolean not null default false,
  notified_manager boolean not null default false,
  note text,
  count_missing boolean not null default false,

  -- prevent duplicates per shift/count_type (only one start, one end, etc.)
  unique (shift_id, count_type)
);

-- sanity to avoid fat-finger nonsense; allow up to $1,000
alter table public.shift_drawer_counts
  drop constraint if exists shift_drawer_counts_range;
alter table public.shift_drawer_counts
  add constraint shift_drawer_counts_range
  check (drawer_cents between 0 and 100000);

create index if not exists shift_drawer_counts_shift_idx on public.shift_drawer_counts(shift_id);

-- ----------------------------
-- 4) Seed stores (LV1/LV2) with QR tokens (safe to re-run)
-- ----------------------------
insert into public.stores (name, qr_token)
values
  ('LV1', encode(gen_random_bytes(16), 'hex')),
  ('LV2', encode(gen_random_bytes(16), 'hex'))
on conflict (name) do nothing;

-- ----------------------------
-- 5) Checklists (per-store templates)
-- ----------------------------
create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  shift_type public.shift_type not null, -- templates for open/close
  created_at timestamptz not null default now(),
  unique(store_id, name, shift_type)
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  label text not null,
  sort_order integer not null,
  required boolean not null default true
);

create table if not exists public.shift_checklist_checks (
  shift_id uuid not null references public.shifts(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id) on delete cascade,
  checked_at timestamptz not null default now(),
  primary key (shift_id, item_id)
);

create index if not exists shift_checklist_checks_shift_idx on public.shift_checklist_checks(shift_id);

-- Seed templates
insert into public.checklist_templates (store_id, name, shift_type)
select s.id, t.name, t.shift_type
from public.stores s
cross join (values
  ('Open Checklist', 'open'),
  ('Close Checklist', 'close')
) as t(name, shift_type)
on conflict do nothing;

-- Seed Open items
insert into public.checklist_items (template_id, label, sort_order)
select t.id, v.label, v.sort_order
from public.checklist_templates t
join (values
  ('Count Drawer', 1),
  ('Case Lights', 2),
  ('Clean Glass', 3),
  ('Cleaning List Tasks', 4),
  ('Changeover', 5)
) as v(label, sort_order)
on t.name = 'Open Checklist' and t.shift_type = 'open'
on conflict do nothing;

-- Seed Close items
insert into public.checklist_items (template_id, label, sort_order)
select t.id, v.label, v.sort_order
from public.checklist_templates t
join (values
  ('Changeover / Count Drawer', 1),
  ('Cleaning List Tasks', 2),
  ('Clean Glass', 3),
  ('Sweep / Mop / Vacuum', 4),
  ('Check Bathroom & Other Supplies', 5),
  ('Close Drawer / Fill out Report', 6)
) as v(label, sort_order)
on t.name = 'Close Checklist' and t.shift_type = 'close'
on conflict do nothing;

-- ----------------------------
-- 6) Enforce required counts before clock-out
--   - other: no requirements
--   - open/close: require start + end
--   - double: require start + changeover + end
-- ----------------------------
create or replace function public.enforce_required_drawer_counts()
returns trigger
language plpgsql
as $$
declare
  st public.shift_type;
  has_start boolean;
  has_end boolean;
  has_changeover boolean;
begin
  -- Only enforce when ending a shift
  if new.ended_at is null then
    return new;
  end if;

  select shift_type into st from public.shifts where id = new.id;

  if st = 'other' then
    return new;
  end if;

  select exists (
    select 1 from public.shift_drawer_counts
    where shift_id = new.id and count_type = 'start'
  ) into has_start;

  select exists (
    select 1 from public.shift_drawer_counts
    where shift_id = new.id and count_type = 'end'
  ) into has_end;

  select exists (
    select 1 from public.shift_drawer_counts
    where shift_id = new.id and count_type = 'changeover'
  ) into has_changeover;

  if not has_start then
    raise exception 'Cannot clock out: missing START drawer count';
  end if;

  if st = 'double' and not has_changeover then
    raise exception 'Cannot clock out: missing CHANGEOVER drawer count (required for DOUBLE)';
  end if;

  if not has_end then
    raise exception 'Cannot clock out: missing END drawer count';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_required_drawer_counts on public.shifts;

create trigger trg_enforce_required_drawer_counts
before update of ended_at on public.shifts
for each row
execute function public.enforce_required_drawer_counts();

-- ----------------------------
-- 7) Export view for CSV (includes drawer counts + deltas)
--   FIX: use bool_or for booleans (max(boolean) is invalid)
-- ----------------------------
create or replace view public.shift_export as
with counts as (
  select
    sdc.shift_id,

    max(case when sdc.count_type = 'start' then sdc.drawer_cents end) as start_drawer_cents,
    max(case when sdc.count_type = 'changeover' then sdc.drawer_cents end) as changeover_drawer_cents,
    max(case when sdc.count_type = 'end' then sdc.drawer_cents end) as end_drawer_cents,

    bool_or(case when sdc.count_type = 'start' then sdc.confirmed else false end) as start_confirmed,
    bool_or(case when sdc.count_type = 'start' then sdc.notified_manager else false end) as start_notified,
    max(case when sdc.count_type = 'start' then sdc.note end) as start_note,

    bool_or(case when sdc.count_type = 'changeover' then sdc.confirmed else false end) as changeover_confirmed,
    bool_or(case when sdc.count_type = 'changeover' then sdc.notified_manager else false end) as changeover_notified,
    max(case when sdc.count_type = 'changeover' then sdc.note end) as changeover_note,

    bool_or(case when sdc.count_type = 'end' then sdc.confirmed else false end) as end_confirmed,
    bool_or(case when sdc.count_type = 'end' then sdc.notified_manager else false end) as end_notified,
    max(case when sdc.count_type = 'end' then sdc.note end) as end_note

  from public.shift_drawer_counts sdc
  group by sdc.shift_id
)
select
  s.id as shift_id,
  p.name as employee,
  st.name as store,
  s.shift_type,
  s.planned_start_at,
  s.started_at,
  s.ended_at,
  round(extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))/3600.0, 2) as hours,

  st.expected_drawer_cents,

  c.start_drawer_cents,
  (c.start_drawer_cents - st.expected_drawer_cents) as start_delta_cents,
  c.start_confirmed,
  c.start_notified,
  c.start_note,

  c.changeover_drawer_cents,
  (c.changeover_drawer_cents - st.expected_drawer_cents) as changeover_delta_cents,
  c.changeover_confirmed,
  c.changeover_notified,
  c.changeover_note,

  c.end_drawer_cents,
  (c.end_drawer_cents - st.expected_drawer_cents) as end_delta_cents,
  c.end_confirmed,
  c.end_notified,
  c.end_note,

  (c.end_drawer_cents - c.start_drawer_cents) as shift_delta_cents

from public.shifts s
join public.profiles p on p.id = s.profile_id
join public.stores st on st.id = s.store_id
left join counts c on c.shift_id = s.id;

-- ============================================================
-- Done.
-- Optional seeds below.
-- ============================================================

-- Optional: seed employees
insert into public.profiles (name)
values ('Sam'), ('Dorothy'), ('Colton'), ('Tay'), ('Jeff')
on conflict do nothing;

-- Optional: everyone can work both stores
insert into public.store_memberships (store_id, profile_id)
select s.id, p.id
from public.stores s
cross join public.profiles p
on conflict do nothing;

-- ============================================================
-- END 01_schema.sql
-- ============================================================

-- ============================================================
-- BEGIN 02_variance_review.sql
-- ============================================================

alter table public.shift_drawer_counts
add column if not exists reviewed_at timestamptz null,
add column if not exists reviewed_by uuid null;

alter table public.shift_drawer_counts
add column if not exists out_of_threshold boolean not null default false;

create index if not exists idx_shift_drawer_counts_needs_review
on public.shift_drawer_counts (out_of_threshold, reviewed_at)
where out_of_threshold = true and reviewed_at is null;

-- ============================================================
-- END 02_variance_review.sql
-- ============================================================

-- ============================================================
-- BEGIN 03_app_users.sql
-- ============================================================

create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text not null,
  role text not null default 'manager' check (role in ('manager')),
  created_at timestamptz not null default now()
);

alter table public.app_users enable row level security;

-- Only the logged in user can read their own app_user row
create policy "app_users_read_own"
on public.app_users
for select
using (auth.uid() = id);

-- Only the logged in user can update their own display name (optional)
create policy "app_users_update_own"
on public.app_users
for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- ============================================================
-- END 03_app_users.sql
-- ============================================================

-- ============================================================
-- BEGIN 04_store_managers.sql
-- ============================================================

create table if not exists public.store_managers (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

alter table public.store_managers enable row level security;

-- Only managers assigned to a store can see their assignments
create policy "store_managers_read_own"
on public.store_managers
for select
using (auth.uid() = user_id);

-- ============================================================
-- END 04_store_managers.sql
-- ============================================================

-- ============================================================
-- BEGIN 05_payroll_rpc.sql
-- ============================================================

create or replace function public.payroll_shifts_range(
  p_from timestamptz,
  p_to   timestamptz,
  p_store_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  store_id uuid,
  start_at timestamptz,
  end_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Require auth
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    s.id,
    s.profile_id as user_id,
    s.store_id,
    s.started_at as start_at,
    s.ended_at   as end_at
  from public.shifts s
  where s.started_at >= p_from
    and s.started_at < p_to
    and s.ended_at is not null
    and exists (
      select 1
      from public.store_managers sm
      where sm.store_id = s.store_id
        and sm.user_id = auth.uid()
    )
    and (p_store_id is null or s.store_id = p_store_id)
  order by s.started_at asc;
end;
$$;

revoke all on function public.payroll_shifts_range(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.payroll_shifts_range(timestamptz, timestamptz, uuid) to authenticated;

-- ============================================================
-- END 05_payroll_rpc.sql
-- ============================================================

-- ============================================================
-- BEGIN 06_seed_managers.sql
-- ============================================================

-- Seed initial manager account + store assignments
-- Update or extend when additional managers are added.

insert into public.app_users (id, email, display_name, role)
values ('a4864e33-10ab-4730-8e73-edc2b52d3393', 'samuelstevens730@gmail.com', 'Sam Stevens', 'manager')
on conflict (id) do nothing;

insert into public.store_managers (store_id, user_id)
values
  ('98ab1644-5c82-4432-a661-f018bd9d4dc8', 'a4864e33-10ab-4730-8e73-edc2b52d3393'),
  ('ad4b6add-9c56-4708-99d2-6c78134f07fd', 'a4864e33-10ab-4730-8e73-edc2b52d3393')
on conflict do nothing;

-- ============================================================
-- END 06_seed_managers.sql
-- ============================================================

-- ============================================================
-- BEGIN 07_shift_assignments.sql
-- ============================================================

do $$ begin
  create type public.assignment_type as enum ('task','message');
exception when duplicate_object then null;
end $$;

create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  type public.assignment_type not null,
  message text not null,

  -- assignment target (exactly one should be set)
  target_profile_id uuid references public.profiles(id) on delete cascade,
  target_store_id uuid references public.stores(id) on delete cascade,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,

  -- delivery to a specific shift (next shift semantics)
  delivered_at timestamptz,
  delivered_shift_id uuid references public.shifts(id) on delete set null,
  delivered_profile_id uuid references public.profiles(id) on delete set null,
  delivered_store_id uuid references public.stores(id) on delete set null,

  -- message ack / task completion
  acknowledged_at timestamptz,
  acknowledged_shift_id uuid references public.shifts(id) on delete set null,
  completed_at timestamptz,
  completed_shift_id uuid references public.shifts(id) on delete set null,

  -- admin audit note
  audit_note text,
  audit_note_updated_at timestamptz,
  audit_note_by uuid references auth.users(id) on delete set null,

  -- soft delete
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

alter table public.shift_assignments
  drop constraint if exists shift_assignments_target_check;
alter table public.shift_assignments
  add constraint shift_assignments_target_check
  check (
    (target_profile_id is not null and target_store_id is null)
    or
    (target_profile_id is null and target_store_id is not null)
  );

create index if not exists idx_shift_assignments_target_profile
  on public.shift_assignments (target_profile_id)
  where target_profile_id is not null;

create index if not exists idx_shift_assignments_target_store
  on public.shift_assignments (target_store_id)
  where target_store_id is not null;

create index if not exists idx_shift_assignments_pending
  on public.shift_assignments (delivered_at)
  where delivered_at is null;

create index if not exists idx_shift_assignments_delivered_shift
  on public.shift_assignments (delivered_shift_id);

create index if not exists idx_shift_assignments_deleted
  on public.shift_assignments (deleted_at)
  where deleted_at is not null;

-- ============================================================
-- END 07_shift_assignments.sql
-- ============================================================

-- ============================================================
-- BEGIN 08_checklists_per_store.sql
-- ============================================================

-- Add per-store checklist templates and backfill from legacy templates.
-- Safe to run once when migrating from the old schema.

alter table public.checklist_templates
  add column if not exists store_id uuid null references public.stores(id) on delete cascade;

alter table public.checklist_templates
  drop constraint if exists checklist_templates_name_shift_type_key;

create unique index if not exists checklist_templates_store_name_shift_type_key
  on public.checklist_templates (store_id, name, shift_type);

-- Create per-store templates from legacy templates (store_id is null)
insert into public.checklist_templates (store_id, name, shift_type)
select s.id, t.name, t.shift_type
from public.stores s
cross join (
  select distinct name, shift_type
  from public.checklist_templates
  where store_id is null
) t
where not exists (
  select 1
  from public.checklist_templates ct
  where ct.store_id = s.id
    and ct.name = t.name
    and ct.shift_type = t.shift_type
);

-- Copy items from legacy templates into the new per-store templates
insert into public.checklist_items (template_id, label, sort_order, required)
select ct_new.id, ci.label, ci.sort_order, ci.required
from public.checklist_templates ct_old
join public.checklist_items ci on ci.template_id = ct_old.id
join public.checklist_templates ct_new
  on ct_new.store_id is not null
  and ct_new.name = ct_old.name
  and ct_new.shift_type = ct_old.shift_type
where ct_old.store_id is null
  and not exists (
    select 1
    from public.checklist_items ci2
    where ci2.template_id = ct_new.id
      and ci2.label = ci.label
      and ci2.sort_order = ci.sort_order
  );

-- ============================================================
-- END 08_checklists_per_store.sql
-- ============================================================

-- ============================================================
-- BEGIN 09_missing_counts.sql
-- ============================================================

alter table public.shift_drawer_counts
  add column if not exists count_missing boolean not null default false;

create index if not exists idx_shift_drawer_counts_missing
  on public.shift_drawer_counts (count_missing)
  where count_missing = true;

-- ============================================================
-- END 09_missing_counts.sql
-- ============================================================

-- ============================================================
-- BEGIN 10_shift_rules.sql
-- ============================================================

-- Shift rules: single open shift per profile + long-shift override support

alter table public.profiles
  add column if not exists auth_user_id uuid null references auth.users(id) on delete set null;

create unique index if not exists profiles_auth_user_id_key
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

alter table public.shifts
  add column if not exists requires_override boolean not null default false,
  add column if not exists override_at timestamptz null,
  add column if not exists override_by uuid null,
  add column if not exists override_note text null;

create unique index if not exists shifts_one_open_per_profile_idx
  on public.shifts (profile_id)
  where ended_at is null;

create index if not exists shifts_requires_override_idx
  on public.shifts (requires_override, override_at)
  where requires_override = true and override_at is null;

-- ============================================================
-- END 10_shift_rules.sql
-- ============================================================

-- ============================================================
-- BEGIN 11_rls.sql
-- ============================================================

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

-- ============================================================
-- END 11_rls.sql
-- ============================================================

-- ============================================================
-- BEGIN 12_assignments_soft_delete.sql
-- ============================================================

alter table public.shift_assignments
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references auth.users(id) on delete set null;

create index if not exists idx_shift_assignments_deleted
  on public.shift_assignments (deleted_at)
  where deleted_at is not null;

-- ============================================================
-- END 12_assignments_soft_delete.sql
-- ============================================================

-- ============================================================
-- BEGIN 13_shift_audit.sql
-- ============================================================

alter table public.shifts
  add column if not exists last_action text not null default 'added'
    check (last_action in ('added','edited','removed')),
  add column if not exists last_action_by uuid null references auth.users(id) on delete set null;

create index if not exists idx_shifts_last_action
  on public.shifts (last_action);

-- ============================================================
-- END 13_shift_audit.sql
-- ============================================================

-- ============================================================
-- BEGIN 14_change_drawer.sql
-- ============================================================

-- Add change drawer count to shift drawer counts
alter table public.shift_drawer_counts
  add column if not exists change_count integer;

-- ============================================================
-- END 14_change_drawer.sql
-- ============================================================

-- ============================================================
-- BEGIN 15_manual_close_review.sql
-- ============================================================

-- Track employee manual shift closures + manager review status
alter table public.shifts
  add column if not exists manual_closed boolean not null default false,
  add column if not exists manual_closed_at timestamptz,
  add column if not exists manual_closed_by_profile uuid references public.profiles(id) on delete set null,
  add column if not exists manual_closed_review_status text check (manual_closed_review_status in ('approved','edited','removed')),
  add column if not exists manual_closed_reviewed_at timestamptz,
  add column if not exists manual_closed_reviewed_by uuid references auth.users(id) on delete set null;

create index if not exists idx_shifts_manual_closed
  on public.shifts (manual_closed, manual_closed_reviewed_at);

-- ============================================================
-- END 15_manual_close_review.sql
-- ============================================================

-- ============================================================
-- BEGIN 16_clock_windows.sql
-- ============================================================

-- Clock window config + enforcement trigger (America/Chicago)
-- NOTE: Triggers must be created in Supabase SQL editor.

create table if not exists public.clock_windows (
  id uuid primary key default gen_random_uuid(),
  store_key text not null check (store_key in ('LV1','LV2')),
  shift_type text not null check (shift_type in ('open','close')),
  dow smallint not null check (dow between 0 and 6),
  start_min smallint not null check (start_min between 0 and 1439),
  end_min smallint not null check (end_min between 0 and 1439),
  crosses_midnight boolean not null default false,
  label text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_clock_windows_lookup
  on public.clock_windows (store_key, shift_type, dow);

-- Seed windows (safe to re-run)
insert into public.clock_windows (store_key, shift_type, dow, start_min, end_min, crosses_midnight, label)
values
  -- OPEN (9 AM) Mon-Sat
  ('LV1','open',1,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',2,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',3,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',4,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',5,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',6,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',1,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',2,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',3,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',4,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',5,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',6,535,545,false,'Open window 8:55-9:05 AM CST'),
  -- OPEN Sunday (12 PM)
  ('LV1','open',0,715,725,false,'Open window 11:55-12:05 PM CST'),
  ('LV2','open',0,715,725,false,'Open window 11:55-12:05 PM CST'),

  -- CLOSE LV1
  ('LV1','close',1,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV1','close',2,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV1','close',3,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV1','close',4,1310,1335,false,'Close window 9:50-10:15 PM CST'),
  ('LV1','close',5,1310,1335,false,'Close window 9:50-10:15 PM CST'),
  ('LV1','close',6,1310,1335,false,'Close window 9:50-10:15 PM CST'),
  ('LV1','close',0,1250,1275,false,'Close window 8:50-9:15 PM CST'),

  -- CLOSE LV2
  ('LV2','close',1,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV2','close',2,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV2','close',3,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV2','close',4,1310,1335,false,'Close window 9:50-10:15 PM CST'),
  ('LV2','close',5,1430,15,true,'Close window 11:50 PM-12:15 AM CST'),
  ('LV2','close',6,1430,15,true,'Close window 11:50 PM-12:15 AM CST'),
  ('LV2','close',0,1250,1275,false,'Close window 8:50-9:15 PM CST')
on conflict do nothing;

-- Helper to get store_key (LV1/LV2) from stores.name
create or replace function public.store_key_for_id(p_store_id uuid)
returns text
language sql
stable
as $$
  select case
    when s.name ilike 'LV1' then 'LV1'
    when s.name ilike 'LV2' then 'LV2'
    else null
  end
  from public.stores s
  where s.id = p_store_id
$$;

-- Validate a timestamp against window rules
create or replace function public.clock_window_check(
  p_store_id uuid,
  p_shift_type text,
  p_time timestamptz
)
returns void
language plpgsql
security definer
as $$
declare
  v_store_key text;
  local_ts timestamp;
  local_dow int;
  local_min int;
  ok boolean := false;
  lbl text := null;
begin
  v_store_key := public.store_key_for_id(p_store_id);
  if v_store_key is null then
    raise exception 'CLOCK_WINDOW_VIOLATION: unknown store' using errcode = 'P0001';
  end if;

  -- derive local time in America/Chicago
  local_ts := p_time at time zone 'America/Chicago';
  local_dow := extract(dow from local_ts);
  local_min := extract(hour from local_ts) * 60 + extract(minute from local_ts);

  -- try exact day window
  select cw.label,
         (
           (not cw.crosses_midnight and local_min between cw.start_min and cw.end_min and cw.dow = local_dow)
           or
           (cw.crosses_midnight and cw.dow = local_dow and (local_min >= cw.start_min or local_min <= cw.end_min))
           or
           (cw.crosses_midnight and ((cw.dow + 1) % 7) = local_dow and local_min <= cw.end_min)
         )
  into lbl, ok
  from public.clock_windows cw
  where cw.store_key = v_store_key
    and cw.shift_type = p_shift_type
    and (
      cw.dow = local_dow
      or (cw.crosses_midnight and ((cw.dow + 1) % 7) = local_dow)
    )
  limit 1;

  if not ok then
    raise exception 'CLOCK_WINDOW_VIOLATION: %', coalesce(lbl, 'Outside allowed clock window')
      using errcode = 'P0001';
  end if;
end;
$$;

-- Trigger to enforce clock windows on shifts
create or replace function public.enforce_clock_windows()
returns trigger
language plpgsql
as $$
begin
  -- Clock-in: validate planned_start_at for open only
  if TG_OP = 'INSERT' then
    if new.shift_type in ('open') then
      perform public.clock_window_check(new.store_id, new.shift_type, new.planned_start_at);
    end if;
    return new;
  end if;

  -- Clock-out: validate ended_at for close shifts only
  if TG_OP = 'UPDATE' and new.ended_at is distinct from old.ended_at and new.ended_at is not null then
    if new.shift_type = 'close' then
      perform public.clock_window_check(new.store_id, 'close', new.ended_at);
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_clock_windows on public.shifts;
create trigger trg_enforce_clock_windows
before insert or update of ended_at on public.shifts
for each row
execute function public.enforce_clock_windows();

-- ============================================================
-- END 16_clock_windows.sql
-- ============================================================

-- ============================================================
-- BEGIN 17_pin_auth.sql
-- ============================================================

-- PIN auth columns + uniqueness guard for employee profiles
-- NOTE: pin_hash is bcrypt; uniqueness is enforced via pin_fingerprint (deterministic HMAC stored by app).

alter table public.profiles
  add column if not exists pin_hash text,
  add column if not exists pin_fingerprint text,
  add column if not exists pin_locked_until timestamptz,
  add column if not exists pin_failed_attempts int default 0;

-- Only allow unique active PINs (via deterministic fingerprint, not bcrypt hash).
create unique index if not exists idx_profiles_pin_unique_active
  on public.profiles (pin_fingerprint)
  where pin_fingerprint is not null and active = true;

-- Optional lookup index for auth checks
create index if not exists idx_profiles_pin_active
  on public.profiles(pin_fingerprint)
  where pin_fingerprint is not null and active = true;

-- ============================================================
-- END 17_pin_auth.sql
-- ============================================================

