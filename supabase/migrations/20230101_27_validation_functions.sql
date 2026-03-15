create or replace function public.check_bilocation_conflict(
  p_profile_id uuid,
  p_shift_date date,
  p_scheduled_start time,
  p_scheduled_end time,
  p_exclude_shift_id uuid
)
returns table (
  shift_id uuid,
  store_id uuid,
  profile_id uuid,
  shift_date date,
  scheduled_start time,
  scheduled_end time
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ts_start timestamptz;
  target_ts_end timestamptz;
begin
  target_ts_start := (p_shift_date + p_scheduled_start)::timestamptz;
  target_ts_end := (p_shift_date + p_scheduled_end)::timestamptz;
  if p_scheduled_end < p_scheduled_start then
    target_ts_end := target_ts_end + interval '1 day';
  end if;

  return query
  select
    ss.id as shift_id,
    ss.store_id,
    ss.profile_id,
    ss.shift_date,
    ss.scheduled_start,
    ss.scheduled_end
  from public.schedule_shifts ss
  join public.schedules sc on sc.id = ss.schedule_id
  where sc.status = 'published'
    and ss.profile_id = p_profile_id
    and (p_exclude_shift_id is null or ss.id <> p_exclude_shift_id)
    and ss.shift_date between (p_shift_date - 1) and (p_shift_date + 1)
    and (
      (ss.shift_date + ss.scheduled_start)::timestamptz
        < target_ts_end
      and
      ((ss.shift_date + ss.scheduled_end)::timestamptz
        + case when ss.scheduled_end < ss.scheduled_start then interval '1 day' else interval '0 day' end)
        > target_ts_start
    );
end;
$$;

create or replace function public.check_time_off_schedule_conflict(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  shift_id uuid,
  store_id uuid,
  profile_id uuid,
  shift_date date,
  scheduled_start time,
  scheduled_end time
)
language plpgsql
security definer
set search_path = public
as $$
declare
  range_start date;
  range_end date;
begin
  range_start := p_start_date - 1;
  range_end := p_end_date;

  return query
  select
    ss.id as shift_id,
    ss.store_id,
    ss.profile_id,
    ss.shift_date,
    ss.scheduled_start,
    ss.scheduled_end
  from public.schedule_shifts ss
  join public.schedules sc on sc.id = ss.schedule_id
  where sc.status = 'published'
    and ss.profile_id = p_profile_id
    and ss.shift_date between range_start and range_end;
end;
$$;

create or replace function public.check_solo_coverage_conflict(
  p_store_id uuid,
  p_shift_date date,
  p_shift_type public.shift_type,
  p_scheduled_start time,
  p_scheduled_end time,
  p_exclude_shift_id uuid
)
returns table (
  shift_id uuid,
  store_id uuid,
  profile_id uuid,
  shift_date date,
  scheduled_start time,
  scheduled_end time
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ts_start timestamptz;
  target_ts_end timestamptz;
begin
  target_ts_start := (p_shift_date + p_scheduled_start)::timestamptz;
  target_ts_end := (p_shift_date + p_scheduled_end)::timestamptz;
  if p_scheduled_end < p_scheduled_start then
    target_ts_end := target_ts_end + interval '1 day';
  end if;

  return query
  select
    ss.id as shift_id,
    ss.store_id,
    ss.profile_id,
    ss.shift_date,
    ss.scheduled_start,
    ss.scheduled_end
  from public.schedule_shifts ss
  join public.schedules sc on sc.id = ss.schedule_id
  where sc.status = 'published'
    and ss.store_id = p_store_id
    and ss.shift_type = p_shift_type
    and (p_exclude_shift_id is null or ss.id <> p_exclude_shift_id)
    and ss.shift_date between (p_shift_date - 1) and (p_shift_date + 1)
    and (
      (ss.shift_date + ss.scheduled_start)::timestamptz
        < target_ts_end
      and
      ((ss.shift_date + ss.scheduled_end)::timestamptz
        + case when ss.scheduled_end < ss.scheduled_start then interval '1 day' else interval '0 day' end)
        > target_ts_start
    );
end;
$$;

create or replace function public.check_payroll_lock(
  p_shift_started_at timestamptz
)
returns table (
  is_locked boolean,
  period_start date,
  period_end date,
  current_period_start date,
  current_period_end date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  shift_local_date date;
  current_local_date date;
  shift_month_start date;
  current_month_start date;
begin
  shift_local_date := (p_shift_started_at at time zone 'America/Chicago')::date;
  current_local_date := (now() at time zone 'America/Chicago')::date;

  shift_month_start := date_trunc('month', shift_local_date)::date;
  current_month_start := date_trunc('month', current_local_date)::date;

  if extract(day from shift_local_date) <= 15 then
    period_start := shift_month_start;
    period_end := (shift_month_start + interval '14 days')::date;
  else
    period_start := (shift_month_start + interval '15 days')::date;
    period_end := (shift_month_start + interval '1 month - 1 day')::date;
  end if;

  if extract(day from current_local_date) <= 15 then
    current_period_start := current_month_start;
    current_period_end := (current_month_start + interval '14 days')::date;
  else
    current_period_start := (current_month_start + interval '15 days')::date;
    current_period_end := (current_month_start + interval '1 month - 1 day')::date;
  end if;

  is_locked := period_end < current_period_start;

  return query
  select is_locked, period_start, period_end, current_period_start, current_period_end;
end;
$$;
