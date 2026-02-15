-- Safe Ledger closeout foundation (schema + RLS + submit RPC)

-- 1) Core tables
create table if not exists public.safe_closeouts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  business_date date not null,
  shift_id uuid references public.shifts(id) on delete set null,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'pass', 'warn', 'fail', 'locked')),
  cash_sales_cents integer not null default 0 check (cash_sales_cents >= 0),
  card_sales_cents integer not null default 0 check (card_sales_cents >= 0),
  other_sales_cents integer not null default 0 check (other_sales_cents >= 0),
  expected_deposit_cents integer not null default 0 check (expected_deposit_cents >= 0),
  actual_deposit_cents integer not null default 0 check (actual_deposit_cents >= 0),
  denom_total_cents integer not null default 0 check (denom_total_cents >= 0),
  drawer_count_cents integer check (drawer_count_cents is null or drawer_count_cents >= 0),
  variance_cents integer not null default 0,
  denoms_jsonb jsonb not null default '{}'::jsonb
    check (jsonb_typeof(denoms_jsonb) = 'object'),
  deposit_override_reason text,
  validation_attempts integer not null default 0 check (validation_attempts >= 0),
  requires_manager_review boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, business_date)
);

create table if not exists public.safe_closeout_expenses (
  id uuid primary key default gen_random_uuid(),
  closeout_id uuid not null references public.safe_closeouts(id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  category text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.safe_closeout_photos (
  id uuid primary key default gen_random_uuid(),
  closeout_id uuid not null references public.safe_closeouts(id) on delete cascade,
  photo_type text not null check (photo_type in ('deposit_required', 'pos_optional')),
  storage_path text,
  thumb_path text,
  purge_after timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_safe_closeouts_store_date
  on public.safe_closeouts(store_id, business_date desc);

create index if not exists idx_safe_closeouts_status_review
  on public.safe_closeouts(status, requires_manager_review, business_date desc);

create index if not exists idx_safe_closeout_expenses_closeout
  on public.safe_closeout_expenses(closeout_id);

create index if not exists idx_safe_closeout_photos_closeout
  on public.safe_closeout_photos(closeout_id);

create index if not exists idx_safe_closeout_photos_purge
  on public.safe_closeout_photos(purge_after)
  where storage_path is not null;

-- 2) Store settings additions
alter table if exists public.store_settings
  add column if not exists safe_ledger_enabled boolean not null default false,
  add column if not exists safe_deposit_tolerance_cents integer not null default 100,
  add column if not exists safe_denom_tolerance_cents integer not null default 0,
  add column if not exists safe_photo_retention_days integer not null default 38,
  add column if not exists safe_photo_purge_day_of_month integer not null default 8;

-- 3) RLS
alter table public.safe_closeouts enable row level security;
alter table public.safe_closeout_expenses enable row level security;
alter table public.safe_closeout_photos enable row level security;

drop policy if exists "safe_closeouts_manager_select" on public.safe_closeouts;
create policy "safe_closeouts_manager_select"
on public.safe_closeouts
for select
to authenticated
using (
  exists (
    select 1
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
  or lower(coalesce((coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'role'), '')) = 'manager'
);

drop policy if exists "safe_closeouts_employee_select_own" on public.safe_closeouts;
create policy "safe_closeouts_employee_select_own"
on public.safe_closeouts
for select
to authenticated
using (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid = profile_id
);

drop policy if exists "safe_closeouts_employee_insert_own" on public.safe_closeouts;
create policy "safe_closeouts_employee_insert_own"
on public.safe_closeouts
for insert
to authenticated
with check (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid = profile_id
);

drop policy if exists "safe_closeouts_employee_update_own" on public.safe_closeouts;
create policy "safe_closeouts_employee_update_own"
on public.safe_closeouts
for update
to authenticated
using (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid = profile_id
)
with check (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid = profile_id
);

drop policy if exists "safe_closeout_expenses_manager_select" on public.safe_closeout_expenses;
create policy "safe_closeout_expenses_manager_select"
on public.safe_closeout_expenses
for select
to authenticated
using (
  exists (
    select 1
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
  or lower(coalesce((coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'role'), '')) = 'manager'
);

drop policy if exists "safe_closeout_expenses_employee_all_own" on public.safe_closeout_expenses;
create policy "safe_closeout_expenses_employee_all_own"
on public.safe_closeout_expenses
for all
to authenticated
using (
  exists (
    select 1
    from public.safe_closeouts sc
    where sc.id = closeout_id
      and sc.profile_id = (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
  )
)
with check (
  exists (
    select 1
    from public.safe_closeouts sc
    where sc.id = closeout_id
      and sc.profile_id = (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
  )
);

drop policy if exists "safe_closeout_photos_manager_select" on public.safe_closeout_photos;
create policy "safe_closeout_photos_manager_select"
on public.safe_closeout_photos
for select
to authenticated
using (
  exists (
    select 1
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
  or lower(coalesce((coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'role'), '')) = 'manager'
);

drop policy if exists "safe_closeout_photos_employee_all_own" on public.safe_closeout_photos;
create policy "safe_closeout_photos_employee_all_own"
on public.safe_closeout_photos
for all
to authenticated
using (
  exists (
    select 1
    from public.safe_closeouts sc
    where sc.id = closeout_id
      and sc.profile_id = (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
  )
)
with check (
  exists (
    select 1
    from public.safe_closeouts sc
    where sc.id = closeout_id
      and sc.profile_id = (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
  )
);

-- Store settings read/update access aligned with existing auth patterns.
alter table public.store_settings enable row level security;

drop policy if exists "store_settings_manager_all" on public.store_settings;
create policy "store_settings_manager_all"
on public.store_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.store_managers sm
    where sm.store_id = store_id
      and sm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.store_managers sm
    where sm.store_id = store_id
      and sm.user_id = auth.uid()
  )
);

drop policy if exists "store_settings_employee_read" on public.store_settings;
create policy "store_settings_employee_read"
on public.store_settings
for select
to authenticated
using (
  (
    (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->'store_ids')::jsonb
  ) ? store_id::text
);

-- 4) Submit RPC
create or replace function public.submit_safe_closeout(
  p_closeout_id uuid,
  p_cash_sales_cents integer,
  p_card_sales_cents integer,
  p_other_sales_cents integer,
  p_actual_deposit_cents integer,
  p_drawer_count_cents integer default null,
  p_expenses jsonb default '[]'::jsonb,
  p_denoms jsonb default '{}'::jsonb,
  p_photos jsonb default '[]'::jsonb,
  p_deposit_override_reason text default null
)
returns table (
  status text,
  requires_manager_review boolean,
  validation_attempts integer,
  variance_cents integer,
  expected_deposit_cents integer,
  actual_deposit_cents integer,
  denom_total_cents integer,
  denom_variance_cents integer
)
language plpgsql
set search_path = public
as $$
declare
  v_closeout public.safe_closeouts%rowtype;
  v_settings public.store_settings%rowtype;
  v_expense_item jsonb;
  v_photo_item jsonb;
  v_category text;
  v_photo_type text;
  v_storage_path text;
  v_thumb_path text;
  v_expense_total integer := 0;
  v_amount integer;
  v_denom_100 integer := coalesce((p_denoms->>'100')::integer, 0);
  v_denom_50 integer := coalesce((p_denoms->>'50')::integer, 0);
  v_denom_20 integer := coalesce((p_denoms->>'20')::integer, 0);
  v_denom_10 integer := coalesce((p_denoms->>'10')::integer, 0);
  v_denom_5 integer := coalesce((p_denoms->>'5')::integer, 0);
  v_denom_1 integer := coalesce((p_denoms->>'1')::integer, 0);
  v_raw_expected integer := 0;
  v_expected_deposit integer := 0;
  v_variance integer := 0;
  v_denom_total integer := 0;
  v_denom_variance integer := 0;
  v_deposit_tolerance integer := 100;
  v_denom_tolerance integer := 0;
  v_retention_days integer := 38;
  v_purge_day_of_month integer := 8;
  v_calendar_purge_at timestamptz;
  v_denom_ok boolean := false;
  v_deposit_ok boolean := false;
  v_photo_ok boolean := false;
  v_override_ok boolean := true;
  v_requires_review boolean := false;
  v_next_attempts integer := 0;
  v_final_status text := 'draft';
begin
  if p_closeout_id is null then
    raise exception 'closeout_id is required';
  end if;
  if p_cash_sales_cents < 0 or p_card_sales_cents < 0 or p_other_sales_cents < 0 then
    raise exception 'sales totals must be >= 0';
  end if;
  if p_actual_deposit_cents < 0 then
    raise exception 'actual_deposit_cents must be >= 0';
  end if;
  if p_drawer_count_cents is not null and p_drawer_count_cents < 0 then
    raise exception 'drawer_count_cents must be >= 0 when provided';
  end if;
  if jsonb_typeof(coalesce(p_expenses, '[]'::jsonb)) <> 'array' then
    raise exception 'expenses must be a JSON array';
  end if;
  if jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) <> 'array' then
    raise exception 'photos must be a JSON array';
  end if;
  if jsonb_typeof(coalesce(p_denoms, '{}'::jsonb)) <> 'object' then
    raise exception 'denoms must be a JSON object';
  end if;

  select * into v_closeout
  from public.safe_closeouts
  where id = p_closeout_id
  for update;

  if v_closeout.id is null then
    raise exception 'safe_closeout not found';
  end if;
  if v_closeout.status = 'locked' then
    raise exception 'safe_closeout is locked';
  end if;

  select * into v_settings
  from public.store_settings
  where store_id = v_closeout.store_id;

  v_deposit_tolerance := coalesce(v_settings.safe_deposit_tolerance_cents, 100);
  v_denom_tolerance := coalesce(v_settings.safe_denom_tolerance_cents, 0);
  v_retention_days := coalesce(v_settings.safe_photo_retention_days, 38);
  v_purge_day_of_month := greatest(1, least(coalesce(v_settings.safe_photo_purge_day_of_month, 8), 28));

  -- Replace expenses from payload.
  delete from public.safe_closeout_expenses
  where closeout_id = p_closeout_id;

  for v_expense_item in
    select value
    from jsonb_array_elements(coalesce(p_expenses, '[]'::jsonb))
  loop
    v_amount := coalesce((v_expense_item->>'amount_cents')::integer, 0);
    v_category := nullif(trim(coalesce(v_expense_item->>'category', '')), '');
    if v_amount < 0 then
      raise exception 'expense amount_cents must be >= 0';
    end if;
    if v_category is null then
      raise exception 'expense category is required';
    end if;

    insert into public.safe_closeout_expenses (closeout_id, amount_cents, category, note)
    values (
      p_closeout_id,
      v_amount,
      v_category,
      nullif(trim(coalesce(v_expense_item->>'note', '')), '')
    );

    v_expense_total := v_expense_total + v_amount;
  end loop;

  if v_denom_100 < 0 or v_denom_50 < 0 or v_denom_20 < 0
    or v_denom_10 < 0 or v_denom_5 < 0 or v_denom_1 < 0 then
    raise exception 'denomination quantities must be >= 0';
  end if;

  -- Bills-only denomination total.
  v_denom_total := (v_denom_100 * 10000)
                 + (v_denom_50 * 5000)
                 + (v_denom_20 * 2000)
                 + (v_denom_10 * 1000)
                 + (v_denom_5 * 500)
                 + (v_denom_1 * 100);

  -- Bills-only expected deposit with rounding (.49 down, .50 up).
  v_raw_expected := p_cash_sales_cents - v_expense_total;
  if v_raw_expected < 0 then
    v_expected_deposit := 0;
    v_requires_review := true;
  else
    v_expected_deposit := ((v_raw_expected + 50) / 100) * 100;
  end if;

  v_variance := p_actual_deposit_cents - v_expected_deposit;
  v_denom_variance := p_actual_deposit_cents - v_denom_total;

  v_deposit_ok := abs(v_variance) <= v_deposit_tolerance;
  v_denom_ok := abs(v_denom_variance) <= v_denom_tolerance;

  -- Override requires reason when actual deposit differs from denomination total.
  if p_actual_deposit_cents <> v_denom_total then
    v_override_ok := nullif(trim(coalesce(p_deposit_override_reason, '')), '') is not null;
  end if;

  -- Replace photos from payload.
  delete from public.safe_closeout_photos
  where closeout_id = p_closeout_id;

  v_calendar_purge_at := (
    date_trunc('month', v_closeout.business_date::timestamp)
    + interval '1 month'
    + make_interval(days => v_purge_day_of_month - 1)
  )::timestamptz;

  for v_photo_item in
    select value
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb))
  loop
    v_photo_type := coalesce(v_photo_item->>'photo_type', '');
    if v_photo_type not in ('deposit_required', 'pos_optional') then
      raise exception 'Invalid photo_type. Must be deposit_required or pos_optional.';
    end if;

    v_storage_path := nullif(trim(coalesce(v_photo_item->>'storage_path', '')), '');
    v_thumb_path := nullif(trim(coalesce(v_photo_item->>'thumb_path', '')), '');

    insert into public.safe_closeout_photos (
      closeout_id,
      photo_type,
      storage_path,
      thumb_path,
      purge_after
    )
    values (
      p_closeout_id,
      v_photo_type,
      v_storage_path,
      v_thumb_path,
      coalesce(
        nullif(v_photo_item->>'purge_after', '')::timestamptz,
        v_calendar_purge_at,
        now() + make_interval(days => v_retention_days)
      )
    );
  end loop;

  select exists (
    select 1
    from public.safe_closeout_photos p
    where p.closeout_id = p_closeout_id
      and p.photo_type = 'deposit_required'
      and p.storage_path is not null
  )
  into v_photo_ok;

  v_next_attempts := coalesce(v_closeout.validation_attempts, 0);
  if not (v_denom_ok and v_deposit_ok and v_photo_ok and v_override_ok) then
    v_final_status := 'fail';
    v_next_attempts := v_next_attempts + 1;
    if v_next_attempts >= 2 then
      v_requires_review := true;
    end if;
  elsif abs(v_variance) > 0 or abs(v_denom_variance) > 0 then
    v_final_status := 'warn';
  else
    v_final_status := 'pass';
  end if;

  update public.safe_closeouts
  set
    cash_sales_cents = p_cash_sales_cents,
    card_sales_cents = p_card_sales_cents,
    other_sales_cents = p_other_sales_cents,
    expected_deposit_cents = v_expected_deposit,
    actual_deposit_cents = p_actual_deposit_cents,
    denom_total_cents = v_denom_total,
    drawer_count_cents = p_drawer_count_cents,
    variance_cents = v_variance,
    denoms_jsonb = coalesce(p_denoms, '{}'::jsonb),
    deposit_override_reason = nullif(trim(coalesce(p_deposit_override_reason, '')), ''),
    status = v_final_status,
    validation_attempts = v_next_attempts,
    requires_manager_review = coalesce(v_closeout.requires_manager_review, false) or v_requires_review,
    updated_at = now()
  where id = p_closeout_id;

  return query
  select
    v_final_status,
    (coalesce(v_closeout.requires_manager_review, false) or v_requires_review),
    v_next_attempts,
    v_variance,
    v_expected_deposit,
    p_actual_deposit_cents,
    v_denom_total,
    v_denom_variance;
end;
$$;

revoke all on function public.submit_safe_closeout(uuid, integer, integer, integer, integer, integer, jsonb, jsonb, jsonb, text) from public;
revoke all on function public.submit_safe_closeout(uuid, integer, integer, integer, integer, integer, jsonb, jsonb, jsonb, text) from anon;
grant execute on function public.submit_safe_closeout(uuid, integer, integer, integer, integer, integer, jsonb, jsonb, jsonb, text) to authenticated, service_role;
