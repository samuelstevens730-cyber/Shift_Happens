-- Enable RLS on each table that has policies
alter table public.checklist_item_checks enable row level security;
alter table public.checklist_runs        enable row level security;
alter table public.shifts                enable row level security;
alter table public.store_memberships     enable row level security;
alter table public.variance              enable row level security;

-- Policies (your exported definitions)

create policy "checks mapped"
on "public"."checklist_item_checks"
for all
to authenticated
using (
  exists (
    select 1 from checklist_runs r
    where r.id = checklist_item_checks.run_id
      and has_store_access(r.store_id)
  )
)
with check (
  exists (
    select 1 from checklist_runs r
    where r.id = checklist_item_checks.run_id
      and has_store_access(r.store_id)
  )
);

create policy "runs mapped"
on "public"."checklist_runs"
for all
to authenticated
using (has_store_access(store_id))
with check (has_store_access(store_id));

create policy "insert own shifts"
on "public"."shifts"
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sm self read"
on "public"."store_memberships"
for select
to authenticated
using (user_id = auth.uid());

create policy "variance mapped"
on "public"."variance"
for all
to authenticated
using (
  exists (
    select 1 from day_closes d
    where d.id = variance.day_close_id
      and has_store_access(d.store_id)
  )
)
with check (
  exists (
    select 1 from day_closes d
    where d.id = variance.day_close_id
      and has_store_access(d.store_id)
  )
);
-- 1) Persist changeover confirmation on the shift
alter table public.shifts
  add column if not exists changeover_confirmed boolean not null default false,
  add column if not exists changeover_at timestamptz;

create or replace function public.confirm_changeover(
  p_shift_id uuid,
  p_at timestamptz default now()
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.shifts
     set changeover_confirmed = true,
         changeover_at        = coalesce(p_at, now())
   where id = p_shift_id and end_at is null and user_id = auth.uid();
  if not found then
    raise exception 'Shift not found or already ended (or not yours)';
  end if;
  return true;
end; $$;

grant execute on function public.confirm_changeover(uuid, timestamptz) to authenticated;

-- 2) End shift with simple confirm flags
create or replace function public.end_shift(
  p_shift_id uuid,
  p_end_at   timestamptz default now(),
  p_closing_confirm boolean default false,
  p_manager_override boolean default false
) returns table (id uuid, duration_minutes int)
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz;
  v_changeover boolean;
  v_minutes int;
begin
  select start_at, coalesce(changeover_confirmed,false)
    into v_start, v_changeover
  from public.shifts
  where id = p_shift_id and end_at is null and user_id = auth.uid();

  raise notice 'p_shift_id: %, found shift id: %, user_id: %, auth.uid(): %, end_at: %',
  p_shift_id, id, user_id, auth.uid(), end_at;

  if v_start is null then
    raise exception 'Shift not found or already ended';
  end if;

  v_minutes := extract(epoch from (coalesce(p_end_at, now()) - v_start))::int / 60;

  -- Guard: require some kind of confirmation unless override
  if (not v_changeover) and (not p_closing_confirm) and (not p_manager_override) then
    raise exception 'Changeover/closing not confirmed';
  end if;

  update public.shifts
     set end_at = coalesce(p_end_at, now()),
         status = 'closed'
   where id = p_shift_id;

  return query select p_shift_id, v_minutes;
end; $$;

grant execute on function public.end_shift(uuid, timestamptz, boolean, boolean) to authenticated;

-- optional: nudge schema cache
select pg_notify('pgrst','reload schema');
create table public.cash_count (
  day_close_id uuid not null,
  till_start numeric(10, 2) null default 0,
  till_end_target numeric(10, 2) null default 200,
  counted_till_end numeric(10, 2) null default 0,
  change_drawer_target numeric(10, 2) null default 200,
  deposit_actual numeric(10, 2) null default 0,
  constraint cash_count_pkey primary key (day_close_id),
  constraint cash_count_day_close_id_fkey foreign KEY (day_close_id) references day_closes (id) on delete CASCADE
) TABLESPACE pg_default;
create table public.checklists (
  id uuid not null default gen_random_uuid (),
  name text not null,
  applies_to_role text not null,
  kind text not null,
  store_id text not null,
  constraint checklists_pkey primary key (id),
  constraint checklists_store_id_fkey foreign KEY (store_id) references stores (id),
  constraint checklists_applies_to_role_check check (
    (
      applies_to_role = any (
        array['owner'::text, 'manager'::text, 'clerk'::text]
      )
    )
  ),
  constraint checklists_kind_check check (
    (
      kind = any (
        array['opening'::text, 'closing'::text, 'shift'::text]
      )
    )
  )
) TABLESPACE pg_default;
create table public.checklist_items (
  id uuid not null default gen_random_uuid (),
  checklist_id uuid not null,
  order_num integer not null,
  text text not null,
  required boolean not null default true,
  manager_only boolean not null default false,
  required_for text not null default 'clock_out'::text,
  constraint checklist_items_pkey primary key (id),
  constraint checklist_items_checklist_id_fkey foreign KEY (checklist_id) references checklists (id) on delete CASCADE,
  constraint checklist_items_required_for_check check (
    (
      required_for = any (
        array['clock_in'::text, 'clock_out'::text, 'none'::text]
      )
    )
  )
) TABLESPACE pg_default;
create table public.checklist_item_checks (
  id uuid not null default gen_random_uuid (),
  run_id uuid not null,
  item_id uuid not null,
  checked_by uuid not null,
  checked_at timestamp with time zone not null default now(),
  note text null,
  constraint checklist_item_checks_pkey primary key (id),
  constraint checklist_item_checks_checked_by_fkey foreign KEY (checked_by) references auth.users (id) on delete RESTRICT,
  constraint checklist_item_checks_item_id_fkey foreign KEY (item_id) references checklist_items (id) on delete CASCADE,
  constraint checklist_item_checks_run_id_fkey foreign KEY (run_id) references checklist_runs (id) on delete CASCADE
) TABLESPACE pg_default;
create table public.checklist_runs (
  id uuid not null default gen_random_uuid (),
  checklist_id uuid not null,
  shift_id uuid not null,
  store_id text not null,
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone null,
  status text not null default 'in_progress'::text,
  constraint checklist_runs_pkey primary key (id),
  constraint checklist_runs_checklist_id_fkey foreign KEY (checklist_id) references checklists (id) on delete CASCADE,
  constraint checklist_runs_shift_id_fkey foreign KEY (shift_id) references shifts (id) on delete CASCADE,
  constraint checklist_runs_store_id_fkey foreign KEY (store_id) references stores (id),
  constraint checklist_runs_status_check check (
    (
      status = any (array['in_progress'::text, 'done'::text])
    )
  )
) TABLESPACE pg_default;
create table public.day_closes (
  id uuid not null default gen_random_uuid (),
  date date not null default ((now() AT TIME ZONE 'utc'::text))::date,
  store_id text not null,
  clerk_id uuid not null,
  manager_id uuid null,
  notes text null,
  constraint day_closes_pkey primary key (id),
  constraint day_closes_clerk_id_fkey foreign KEY (clerk_id) references auth.users (id) on delete RESTRICT,
  constraint day_closes_manager_id_fkey foreign KEY (manager_id) references auth.users (id) on delete RESTRICT,
  constraint day_closes_store_id_fkey foreign KEY (store_id) references stores (id)
) TABLESPACE pg_default;
create table public.payment_totals (
  day_close_id uuid not null,
  cash_sales numeric(10, 2) null default 0,
  card_sales numeric(10, 2) null default 0,
  refunds numeric(10, 2) null default 0,
  constraint payment_totals_pkey primary key (day_close_id),
  constraint payment_totals_day_close_id_fkey foreign KEY (day_close_id) references day_closes (id) on delete CASCADE
) TABLESPACE pg_default;
create table public.profiles (
  id uuid not null,
  full_name text null,
  global_role text not null default 'clerk'::text,
  default_store_id text null,
  pin_hash text null,
  pin_updated_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE,
  constraint profiles_global_role_check check (
    (
      global_role = any (
        array['owner'::text, 'manager'::text, 'clerk'::text]
      )
    )
  )
) TABLESPACE pg_default;
-- read your own shifts
create policy if not exists "select own shifts"
on public.shifts for select to authenticated
using (user_id = auth.uid());

-- update your own active shift
create policy if not exists "update own active shifts"
on public.shifts for update to authenticated
using (user_id = auth.uid() and end_at is null)
with check (user_id = auth.uid());
create table public.shifts (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  store_id text not null,
  start_at timestamp with time zone not null default now(),
  end_at timestamp with time zone null,
  status text not null default 'open'::text,
  changeover_confirmed boolean not null default false,
  changeover_at timestamp with time zone null,
  constraint shifts_pkey primary key (id),
  constraint shifts_store_id_fkey foreign KEY (store_id) references stores (id),
  constraint shifts_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete RESTRICT,
  constraint shifts_status_check check (
    (
      status = any (array['open'::text, 'closed'::text])
    )
  )
) TABLESPACE pg_default;
create table public.stores (
  id text not null,
  name text not null,
  constraint stores_pkey primary key (id)
) TABLESPACE pg_default;
create table public.store_memberships (
  user_id uuid not null,
  store_id text not null,
  role text not null,
  constraint store_memberships_pkey primary key (user_id, store_id),
  constraint store_memberships_store_id_fkey foreign KEY (store_id) references stores (id) on delete CASCADE,
  constraint store_memberships_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint store_memberships_role_check check (
    (
      role = any (
        array['owner'::text, 'manager'::text, 'clerk'::text]
      )
    )
  )
) TABLESPACE pg_default;
create table public.variance (
  day_close_id uuid not null,
  expected_deposit numeric(10, 2) not null,
  over_short_amount numeric(10, 2) not null,
  status text not null,
  constraint variance_pkey primary key (day_close_id),
  constraint variance_day_close_id_fkey foreign KEY (day_close_id) references day_closes (id) on delete CASCADE,
  constraint variance_status_check check (
    (
      status = any (array['ok'::text, 'investigate'::text])
    )
  )
) TABLESPACE pg_default;
