-- Fix 1: Correct balance_variance formula in verify_daily_sales_balance() trigger.
-- The trigger was comparing rollover-adjusted verified_total against raw z_report_cents,
-- producing a false mismatch of exactly -rollover_from_previous_cents on every rollover night.
-- The Z side must also have rollover subtracted so both sides net out correctly.
--
-- Fix 2: submit_rollover_entry now sets is_rollover_night = true when source = 'closer'.
-- This ensures the Saturday record is flagged as a rollover night even if close-checkpoint
-- was skipped or failed before its upsert could set the flag.

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
    -- Subtract rollover from both sides so they cancel correctly on rollover nights.
    -- On non-rollover nights rollover_from_previous_cents = 0, so the formula is unchanged.
    new.balance_variance_cents := new.verified_total_cents
      - (coalesce(new.z_report_cents, 0) - coalesce(new.rollover_from_previous_cents, 0));
    new.out_of_balance := abs(new.balance_variance_cents) > coalesce(v_threshold_cents, 100);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

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
       set closer_rollover_cents = p_amount_cents,
           is_rollover_night = true
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
