-- Align clock window enforcement with schedule-first policy.
-- Scheduled shifts are validated by API schedule tolerance.
-- Fallback clock windows are enforced only for unscheduled/manual shifts.

create or replace function public.clock_window_check(
  p_store_id uuid,
  p_shift_type public.shift_type,
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

create or replace function public.enforce_clock_windows()
returns trigger
language plpgsql
as $$
declare
  v_is_scheduled boolean;
begin
  v_is_scheduled := coalesce(new.shift_source, 'manual') = 'scheduled'
                    and new.schedule_shift_id is not null;

  -- Clock-in fallback: enforce open windows only for unscheduled/manual shifts.
  if TG_OP = 'INSERT' then
    if new.shift_type = 'open' and not v_is_scheduled then
      perform public.clock_window_check(new.store_id, new.shift_type, new.planned_start_at);
    end if;
    return new;
  end if;

  -- Clock-out fallback: enforce close windows only for unscheduled/manual shifts.
  if TG_OP = 'UPDATE' and new.ended_at is distinct from old.ended_at and new.ended_at is not null then
    if new.shift_type = 'close' and not v_is_scheduled then
      perform public.clock_window_check(new.store_id, 'close', new.ended_at);
    end if;
    return new;
  end if;

  return new;
end;
$$;

