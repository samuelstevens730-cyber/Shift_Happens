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
