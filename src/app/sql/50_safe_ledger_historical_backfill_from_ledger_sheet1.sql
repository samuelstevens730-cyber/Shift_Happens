-- Historical Safe Ledger backfill from "ledger - Sheet1.csv"
-- Source captured on February 16, 2026.
-- Notes:
-- 1) This script resolves stores from codes `lv1`/`lv2` against `public.stores.name`.
-- 2) Closer names are resolved against `public.profiles.name` (case-insensitive).
-- 3) The CSV had a `$2` denomination column; it is stored in `denoms_jsonb` and included in `denom_total_cents`.
-- 4) Rows are marked `is_historical_backfill = true` so UI can badge them.

begin;

create temp table tmp_safe_ledger_import (
  store_code text not null,
  date_mmdd text not null,
  closer_raw text not null,
  cash numeric(10,2) not null,
  card numeric(10,2) not null,
  deposit numeric(10,2) not null,
  expenses numeric(10,2) not null,
  denom_1 integer,
  denom_2 integer,
  denom_5 integer,
  denom_10 integer,
  denom_20 integer,
  denom_50 integer,
  denom_100 integer
) on commit drop;

insert into tmp_safe_ledger_import (
  store_code, date_mmdd, closer_raw, cash, card, deposit, expenses,
  denom_1, denom_2, denom_5, denom_10, denom_20, denom_50, denom_100
)
values
('lv2','2/1','Colton',76.79,751.43,77,0,2,null,1,1,3,null,null),
('lv2','2/2','Colton',375.68,521.19,375,0,1,null,1,1,8,null,2),
('lv2','2/3','sam',20.01,676.14,20,0,null,null,null,null,1,null,null),
('lv2','2/4','Colton',254.29,308.33,254,0,4,null,20,5,null,null,1),
('lv2','2/5','colton',36.94,537.06,37,0,2,null,1,1,1,null,null),
('lv2','2/6','colton',193.72,739.37,194,0,4,null,20,2,1,1,null),
('lv2','2/7','colton',198.03,498.82,188,10,3,null,1,2,8,null,null),
('lv2','2/8','colton',216.48,1238.07,216,0,1,null,23,null,5,null,null),
('lv2','2/9','colton',37.86,294.83,0,38,null,null,null,null,null,null,null),
('lv2','2/10','sam',216.41,373.32,133,83,3,15,null,2,4,null,null),
('lv2','2/11','colton',239.37,792.58,239,0,4,null,7,4,3,null,1),
('lv2','2/12','colton',43.46,371.15,43,0,3,null,null,null,2,null,null),
('lv2','2/13','colton',141.71,1189.29,142,0,2,null,null,null,7,null,null),
('lv2','2/14','colton',61.20,1015.43,48,13,3,null,1,null,2,null,null),
('lv1','2/1','jeff (no longer employed? link to julian in Profiles for now)',311.84,1251.75,312,0,2,null,2,2,14,null,null),
('lv1','2/2','tay',170.20,667.65,179,0,null,10,5,null,2,null,1),
('lv1','2/3','Dorothy',972.33,678.57,972,0,null,1,2,null,18,null,6),
('lv1','2/4','Tay',271.92,945.99,153,120,3,null,6,null,1,null,1),
('lv1','2/5','tay',273.80,610.49,253,21,3,null,null,1,2,null,2),
('lv1','2/6','tay',586.73,1237.28,587,0,null,1,1,null,14,null,3),
('lv1','2/7','tay',363.37,1410.65,363,0,3,null,null,null,8,null,2),
('lv1','2/8','tay',386.01,1521.03,386,0,1,null,1,null,4,null,3),
('lv1','2/9','tay',167.69,835.98,48,120,3,null,1,null,2,null,null),
('lv1','2/10','dorothy',132.37,1590.92,132,2,null,null,null,1,1,null,1),
('lv1','2/11','tay',235.89,905.68,236,0,1,null,1,1,6,null,1),
('lv1','2/12','tay',198.51,1171.90,199,0,4,null,1,1,4,null,1),
('lv1','2/13','tay',1164.98,859.87,1165,5,null,null,null,null,23,null,7),
('lv1','2/14','tay',371.13,702.05,371,1,null,null,null,7,10,null,1);

create temp table tmp_safe_ledger_resolved as
with normalized as (
  select
    i.*,
    make_date(
      extract(year from current_date)::int,
      split_part(i.date_mmdd, '/', 1)::int,
      split_part(i.date_mmdd, '/', 2)::int
    ) as business_date,
    case
      when lower(i.closer_raw) like 'jeff%' then 'julian'
      else lower(trim(split_part(i.closer_raw, ' ', 1)))
    end as closer_key,
    coalesce(i.denom_1, 0) as d1,
    coalesce(i.denom_2, 0) as d2,
    coalesce(i.denom_5, 0) as d5,
    coalesce(i.denom_10, 0) as d10,
    coalesce(i.denom_20, 0) as d20,
    coalesce(i.denom_50, 0) as d50,
    coalesce(i.denom_100, 0) as d100
  from tmp_safe_ledger_import i
),
resolved as (
  select
    n.*,
    s.id as store_id,
    p.id as profile_id
  from normalized n
  left join lateral (
    select st.id
    from public.stores st
    where lower(st.name) = lower(n.store_code)
       or replace(lower(st.name), ' ', '') = replace(lower(n.store_code), ' ', '')
       or lower(st.name) like '%' || lower(n.store_code) || '%'
    order by case when lower(st.name) = lower(n.store_code) then 0 else 1 end, st.created_at
    limit 1
  ) s on true
  left join lateral (
    select pr.id
    from public.profiles pr
    where lower(pr.name) = n.closer_key
       or lower(pr.name) like n.closer_key || '%'
    order by case when lower(pr.name) = n.closer_key then 0 else 1 end, pr.created_at
    limit 1
  ) p on true
)
select * from resolved;

do $$
declare
  v_missing_store int;
  v_missing_profile int;
begin
  select count(*) into v_missing_store
  from tmp_safe_ledger_resolved
  where store_id is null;

  select count(*) into v_missing_profile
  from tmp_safe_ledger_resolved
  where profile_id is null;

  if v_missing_store > 0 then
    raise exception 'Backfill aborted: % row(s) could not map store_code to public.stores.name.', v_missing_store;
  end if;

  if v_missing_profile > 0 then
    raise exception 'Backfill aborted: % row(s) could not map closer to public.profiles.name.', v_missing_profile;
  end if;
end $$;

create temp table tmp_safe_ledger_upsert as
with prepared as (
  select
    r.store_id,
    r.business_date,
    r.profile_id,
    (round(r.cash * 100))::int as cash_sales_cents,
    (round(r.card * 100))::int as card_sales_cents,
    0::int as other_sales_cents,
    (round(r.deposit * 100))::int as actual_deposit_cents,
    (round(r.expenses * 100))::int as expenses_cents,
    (r.d100 * 10000) + (r.d50 * 5000) + (r.d20 * 2000) + (r.d10 * 1000) + (r.d5 * 500) + (r.d2 * 200) + (r.d1 * 100) as denom_total_cents,
    jsonb_build_object(
      '100', r.d100,
      '50', r.d50,
      '20', r.d20,
      '10', r.d10,
      '5', r.d5,
      '2', r.d2,
      '1', r.d1
    ) as denoms_jsonb
  from tmp_safe_ledger_resolved r
),
calculated as (
  select
    p.*,
    case
      when (p.cash_sales_cents - p.expenses_cents) < 0 then 0
      else ((p.cash_sales_cents - p.expenses_cents + 50) / 100) * 100
    end as expected_deposit_cents
  from prepared p
),
upserted as (
  insert into public.safe_closeouts (
    store_id,
    business_date,
    shift_id,
    profile_id,
    status,
    cash_sales_cents,
    card_sales_cents,
    other_sales_cents,
    expected_deposit_cents,
    actual_deposit_cents,
    denom_total_cents,
    drawer_count_cents,
    variance_cents,
    denoms_jsonb,
    deposit_override_reason,
    validation_attempts,
    requires_manager_review,
    is_historical_backfill,
    updated_at
  )
  select
    c.store_id,
    c.business_date,
    null,
    c.profile_id,
    case
      when abs(c.actual_deposit_cents - c.expected_deposit_cents) >= 5000 then 'fail'
      when c.actual_deposit_cents <> c.expected_deposit_cents or c.actual_deposit_cents <> c.denom_total_cents then 'warn'
      else 'pass'
    end,
    c.cash_sales_cents,
    c.card_sales_cents,
    c.other_sales_cents,
    c.expected_deposit_cents,
    c.actual_deposit_cents,
    c.denom_total_cents,
    20000,
    c.actual_deposit_cents - c.expected_deposit_cents,
    c.denoms_jsonb,
    'Historical backfill import',
    0,
    abs(c.actual_deposit_cents - c.expected_deposit_cents) >= 5000,
    true,
    now()
  from calculated c
  on conflict (store_id, business_date)
  do update set
    profile_id = excluded.profile_id,
    status = excluded.status,
    cash_sales_cents = excluded.cash_sales_cents,
    card_sales_cents = excluded.card_sales_cents,
    other_sales_cents = excluded.other_sales_cents,
    expected_deposit_cents = excluded.expected_deposit_cents,
    actual_deposit_cents = excluded.actual_deposit_cents,
    denom_total_cents = excluded.denom_total_cents,
    drawer_count_cents = excluded.drawer_count_cents,
    variance_cents = excluded.variance_cents,
    denoms_jsonb = excluded.denoms_jsonb,
    deposit_override_reason = excluded.deposit_override_reason,
    requires_manager_review = excluded.requires_manager_review,
    is_historical_backfill = true,
    updated_at = now()
  returning id, store_id, business_date
)
select * from upserted;

delete from public.safe_closeout_expenses e
using tmp_safe_ledger_upsert u
where e.closeout_id = u.id;

insert into public.safe_closeout_expenses (
  closeout_id,
  amount_cents,
  category,
  note
)
select
  u.id,
  (round(r.expenses * 100))::int,
  'historical_backfill',
  'Imported from ledger - Sheet1.csv'
from tmp_safe_ledger_upsert u
join tmp_safe_ledger_resolved r
  on r.store_id = u.store_id
 and r.business_date = u.business_date
where round(r.expenses * 100)::int > 0;

commit;

-- Quick validation
select
  sc.business_date,
  s.name as store_name,
  p.name as closer_name,
  sc.status,
  sc.cash_sales_cents,
  sc.card_sales_cents,
  sc.expected_deposit_cents,
  sc.actual_deposit_cents,
  sc.denom_total_cents,
  sc.variance_cents,
  sc.is_historical_backfill
from public.safe_closeouts sc
join public.stores s on s.id = sc.store_id
join public.profiles p on p.id = sc.profile_id
where sc.is_historical_backfill = true
  and sc.business_date >= make_date(extract(year from current_date)::int, 2, 1)
  and sc.business_date <= make_date(extract(year from current_date)::int, 2, 14)
order by sc.business_date, s.name;
