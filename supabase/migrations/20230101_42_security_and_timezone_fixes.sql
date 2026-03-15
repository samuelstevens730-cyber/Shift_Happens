-- Pass 3 / Step 1.1
-- Fixes:
-- 1) SECURITY DEFINER hardening: add search_path to clock_window_check()
-- 2) Timezone correctness: ensure schedule overlap checks use America/Chicago

create or replace function public.clock_window_check(
  p_store_id uuid,
  p_shift_type public.shift_type,
  p_time timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
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

  local_ts := p_time at time zone 'America/Chicago';
  local_dow := extract(dow from local_ts);
  local_min := extract(hour from local_ts) * 60 + extract(minute from local_ts);

  select exists (
    select 1
    from public.clock_windows cw
    where cw.store_key = v_store_key
      and cw.shift_type = p_shift_type::text
      and (
        cw.dow = local_dow
        or (cw.crosses_midnight and ((cw.dow + 1) % 7) = local_dow)
      )
      and (
        (not cw.crosses_midnight and local_min between cw.start_min and cw.end_min and cw.dow = local_dow)
        or
        (cw.crosses_midnight and cw.dow = local_dow and (local_min >= cw.start_min or local_min <= cw.end_min))
        or
        (cw.crosses_midnight and ((cw.dow + 1) % 7) = local_dow and local_min <= cw.end_min)
      )
  ) into ok;

  if not ok then
    select cw.label
      into lbl
    from public.clock_windows cw
    where cw.store_key = v_store_key
      and cw.shift_type = p_shift_type::text
      and (
        cw.dow = local_dow
        or (cw.crosses_midnight and ((cw.dow + 1) % 7) = local_dow)
      )
    order by
      case when cw.dow = local_dow then 0 else 1 end,
      cw.crosses_midnight desc
    limit 1;

    raise exception 'CLOCK_WINDOW_VIOLATION: %', coalesce(lbl, 'Outside allowed clock window')
      using errcode = 'P0001';
  end if;
end;
$$;

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
  target_ts_start := (p_shift_date + p_scheduled_start) at time zone 'America/Chicago';
  target_ts_end := (p_shift_date + p_scheduled_end) at time zone 'America/Chicago';
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
      (ss.shift_date + ss.scheduled_start) at time zone 'America/Chicago'
        < target_ts_end
      and
      (((ss.shift_date + ss.scheduled_end) at time zone 'America/Chicago')
        + case when ss.scheduled_end < ss.scheduled_start then interval '1 day' else interval '0 day' end)
        > target_ts_start
    );
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
  target_ts_start := (p_shift_date + p_scheduled_start) at time zone 'America/Chicago';
  target_ts_end := (p_shift_date + p_scheduled_end) at time zone 'America/Chicago';
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
      (ss.shift_date + ss.scheduled_start) at time zone 'America/Chicago'
        < target_ts_end
      and
      (((ss.shift_date + ss.scheduled_end) at time zone 'America/Chicago')
        + case when ss.scheduled_end < ss.scheduled_start then interval '1 day' else interval '0 day' end)
        > target_ts_start
    );
end;
$$;

