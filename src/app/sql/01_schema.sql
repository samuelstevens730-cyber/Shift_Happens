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
