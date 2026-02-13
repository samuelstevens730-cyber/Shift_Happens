-- Employee sales tracking foundation
-- Adds shift-level sales entries, daily reconciliation records, rollover config,
-- and transactional RPC for blind dual-entry rollover submission.

-- 1) Enum
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'sales_entry_type'
      and n.nspname = 'public'
  ) then
    create type public.sales_entry_type as enum ('x_report', 'z_report', 'rollover');
  end if;
end
$$;

-- 2) Core tables
create table if not exists public.shift_sales_counts (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  daily_sales_record_id uuid,
  entry_type public.sales_entry_type not null,
  amount_cents integer not null check (amount_cents >= 0),
  prior_x_report_cents integer,
  confirmed boolean default false,
  note text,
  counted_at timestamptz default now(),
  unique (shift_id, entry_type)
);

create table if not exists public.daily_sales_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  business_date date not null,

  -- Shift links
  open_shift_id uuid references public.shifts(id) on delete set null,
  close_shift_id uuid references public.shifts(id) on delete set null,

  -- Raw data
  open_x_report_cents integer,
  close_sales_cents integer,
  z_report_cents integer,

  -- Rollover blind dual-entry
  closer_rollover_cents integer,
  opener_rollover_cents integer,
  rollover_cents integer,

  -- Rollover propagation
  rollover_from_previous_cents integer default 0,
  rollover_to_next_cents integer default 0,

  -- Flags
  rollover_mismatch boolean default false,
  rollover_needs_review boolean default false,
  is_rollover_night boolean default false,

  -- Computed verification
  verified_open_sales_cents integer,
  verified_close_sales_cents integer,
  verified_total_cents integer,
  balance_variance_cents integer default 0,
  out_of_balance boolean default false,

  -- Review fields
  rollover_entered boolean default false,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (store_id, business_date)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_shift_sales_daily_record'
  ) then
    alter table public.shift_sales_counts
      add constraint fk_shift_sales_daily_record
      foreign key (daily_sales_record_id)
      references public.daily_sales_records(id)
      on delete set null;
  end if;
end
$$;

create table if not exists public.store_rollover_config (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  has_rollover boolean default false,
  unique (store_id, day_of_week)
);

-- 3) Settings
alter table if exists public.store_settings
  add column if not exists sales_tracking_enabled boolean default false,
  add column if not exists sales_variance_threshold_cents integer default 100;

-- Seed rollover config for LV2 on Friday(5) and Saturday(6)
insert into public.store_rollover_config (store_id, day_of_week, has_rollover)
select s.id, d.dow, true
from public.stores s
cross join (values (5), (6)) as d(dow)
where lower(s.name) like '%lv2%'
on conflict (store_id, day_of_week) do update
set has_rollover = excluded.has_rollover;

-- 4) Row-level verification trigger
create or replace function public.verify_daily_sales_balance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_threshold_cents integer := 100;
begin
  -- Pull per-store threshold if available
  select coalesce(ss.sales_variance_threshold_cents, 100)
    into v_threshold_cents
  from public.store_settings ss
  where ss.store_id = new.store_id;

  -- Math: Open - PrevRollover + Close = Total
  new.verified_open_sales_cents := coalesce(new.open_x_report_cents, 0) - coalesce(new.rollover_from_previous_cents, 0);
  new.verified_close_sales_cents := coalesce(new.close_sales_cents, 0);
  new.verified_total_cents := new.verified_open_sales_cents + new.verified_close_sales_cents;

  if new.z_report_cents is not null then
    new.balance_variance_cents := new.verified_total_cents - new.z_report_cents;
    new.out_of_balance := abs(new.balance_variance_cents) > coalesce(v_threshold_cents, 100);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trigger_verify_daily_sales on public.daily_sales_records;
create trigger trigger_verify_daily_sales
before insert or update on public.daily_sales_records
for each row
execute function public.verify_daily_sales_balance();

-- 5) Transactional RPC for blind dual-entry rollover submission
create or replace function public.submit_rollover_entry(
  p_store_id uuid,
  p_business_date date,
  p_amount_cents int,
  p_source text, -- 'closer' or 'opener'
  p_force_mismatch boolean default false
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_record_id uuid;
  v_closer_val int;
  v_opener_val int;
  v_next_date date := p_business_date + 1;
begin
  insert into public.daily_sales_records (store_id, business_date, created_at)
  values (p_store_id, p_business_date, now())
  on conflict (store_id, business_date) do nothing;

  if p_source = 'closer' then
    update public.daily_sales_records
       set closer_rollover_cents = p_amount_cents
     where store_id = p_store_id and business_date = p_business_date
    returning id, closer_rollover_cents, opener_rollover_cents
      into v_record_id, v_closer_val, v_opener_val;
  elsif p_source = 'opener' then
    update public.daily_sales_records
       set opener_rollover_cents = p_amount_cents
     where store_id = p_store_id and business_date = p_business_date
    returning id, closer_rollover_cents, opener_rollover_cents
      into v_record_id, v_closer_val, v_opener_val;
  else
    raise exception 'Invalid rollover source. Must be closer or opener.';
  end if;

  if v_closer_val is not null and v_opener_val is not null then
    if v_closer_val = v_opener_val then
      update public.daily_sales_records
         set rollover_cents = v_closer_val,
             rollover_mismatch = false,
             rollover_needs_review = false,
             rollover_to_next_cents = v_closer_val
       where id = v_record_id;

      insert into public.daily_sales_records (store_id, business_date, rollover_from_previous_cents)
      values (p_store_id, v_next_date, v_closer_val)
      on conflict (store_id, business_date)
      do update set rollover_from_previous_cents = excluded.rollover_from_previous_cents;

      return 'MATCHED';
    else
      if p_force_mismatch then
        update public.daily_sales_records
           set rollover_mismatch = true,
               rollover_needs_review = true
         where id = v_record_id;
        return 'MISMATCH_SAVED';
      else
        return 'MISMATCH_DETECTED';
      end if;
    end if;
  else
    update public.daily_sales_records
       set rollover_needs_review = true
     where id = v_record_id;
    return 'PENDING_SECOND_ENTRY';
  end if;
end;
$$;

-- 6) Indexes
create index if not exists idx_daily_sales_store_date
  on public.daily_sales_records(store_id, business_date desc);

create index if not exists idx_daily_sales_needs_review
  on public.daily_sales_records(out_of_balance, reviewed_at)
  where out_of_balance = true and reviewed_at is null;

create index if not exists idx_shift_sales_counts_shift
  on public.shift_sales_counts(shift_id);

