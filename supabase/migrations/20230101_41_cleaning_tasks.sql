-- Separate cleaning tasks subsystem (independent from operational checklist)

create table if not exists public.cleaning_tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  category text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.store_cleaning_schedules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cleaning_task_id uuid not null references public.cleaning_tasks(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  shift_type text not null check (shift_type in ('am', 'pm')),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, cleaning_task_id, day_of_week, shift_type)
);

create table if not exists public.cleaning_task_completions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  store_cleaning_schedule_id uuid not null references public.store_cleaning_schedules(id) on delete cascade,
  status text not null check (status in ('completed', 'skipped')),
  completed_by uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  skipped_reason text,
  created_at timestamptz not null default now(),
  unique (shift_id, store_cleaning_schedule_id)
);

insert into public.cleaning_tasks (name, description, category, sort_order)
values
  ('Sweep Floors', null, 'daily', 1),
  ('Clean Restrooms', null, 'daily', 2),
  ('Clean Office', null, 'daily', 3),
  ('Clean Register', null, 'daily', 4),
  ('Check/Take Out Trash', null, 'daily', 5),
  ('Wipe Glass', null, 'daily', 6),
  ('Mop Floors', null, 'daily', 7),
  ('Dust: Glass Wall', null, 'dusting', 8),
  ('Dust: Novelties Wall', null, 'dusting', 9),
  ('Dust: Kratom/E-Juice Wall', null, 'dusting', 10),
  ('Dust: THC/Cigar Wall', null, 'dusting', 11),
  ('Clean Outside Window', null, 'deep', 12),
  ('Clean Baseboards', null, 'deep', 13),
  ('Clean Case Backs', null, 'deep', 14),
  ('Clean Trash Cans', null, 'deep', 15),
  ('Deep Clean Restroom/Office', null, 'deep', 16),
  ('Deep Clean Register Area', null, 'deep', 17)
on conflict (name) do update
set description = excluded.description,
    category = excluded.category,
    sort_order = excluded.sort_order,
    is_active = true;

create or replace function public.fetch_cleaning_tasks_for_shift(
  p_actor_profile_id uuid,
  p_shift_id uuid
)
returns table (
  schedule_id uuid,
  cleaning_task_id uuid,
  task_name text,
  task_description text,
  task_category text,
  task_sort_order int,
  cleaning_shift_type text,
  day_of_week int,
  status text,
  completed_at timestamptz,
  skipped_reason text,
  completed_by uuid
)
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_shift public.shifts%rowtype;
  v_actor_is_manager boolean;
  v_cleaning_shift_types text[];
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id;

  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  v_actor_is_manager := exists (
    select 1
    from public.profiles p
    join public.store_managers sm on sm.user_id = p.auth_user_id
    where p.id = p_actor_profile_id
      and sm.store_id = v_shift.store_id
  );

  if v_shift.profile_id <> p_actor_profile_id and not v_actor_is_manager then
    raise exception 'Actor not authorized for this shift';
  end if;

  if v_shift.shift_type = 'open' then
    v_cleaning_shift_types := array['am'];
  elsif v_shift.shift_type = 'close' then
    v_cleaning_shift_types := array['pm'];
  elsif v_shift.shift_type = 'double' then
    v_cleaning_shift_types := array['am', 'pm'];
  else
    return;
  end if;

  return query
  select
    scs.id as schedule_id,
    ct.id as cleaning_task_id,
    ct.name as task_name,
    ct.description as task_description,
    ct.category as task_category,
    ct.sort_order as task_sort_order,
    scs.shift_type as cleaning_shift_type,
    scs.day_of_week,
    coalesce(ctc.status, 'pending') as status,
    ctc.completed_at,
    ctc.skipped_reason,
    ctc.completed_by
  from public.store_cleaning_schedules scs
  join public.cleaning_tasks ct on ct.id = scs.cleaning_task_id
  left join public.cleaning_task_completions ctc
    on ctc.store_cleaning_schedule_id = scs.id
   and ctc.shift_id = v_shift.id
  where scs.store_id = v_shift.store_id
    and scs.day_of_week = extract(dow from v_shift.started_at at time zone 'America/Chicago')::int
    and scs.shift_type = any(v_cleaning_shift_types)
    and scs.is_required = true
    and ct.is_active = true
  order by
    case scs.shift_type when 'am' then 0 else 1 end,
    ct.sort_order,
    ct.name;
end;
$$;

revoke all on function public.fetch_cleaning_tasks_for_shift(uuid, uuid) from public;
revoke all on function public.fetch_cleaning_tasks_for_shift(uuid, uuid) from anon;
grant execute on function public.fetch_cleaning_tasks_for_shift(uuid, uuid) to authenticated, service_role;

create or replace function public.complete_cleaning_task(
  p_actor_profile_id uuid,
  p_shift_id uuid,
  p_schedule_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_shift public.shifts%rowtype;
  v_schedule public.store_cleaning_schedules%rowtype;
  v_actor_is_manager boolean;
  v_allowed_shift_types text[];
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  if v_shift.ended_at is not null then
    raise exception 'Shift is not active';
  end if;

  select * into v_schedule
  from public.store_cleaning_schedules
  where id = p_schedule_id;

  if v_schedule.id is null then
    raise exception 'Cleaning schedule not found';
  end if;

  v_actor_is_manager := exists (
    select 1
    from public.profiles p
    join public.store_managers sm on sm.user_id = p.auth_user_id
    where p.id = p_actor_profile_id
      and sm.store_id = v_shift.store_id
  );

  if v_shift.profile_id <> p_actor_profile_id and not v_actor_is_manager then
    raise exception 'Actor not authorized for this shift';
  end if;

  if v_shift.store_id <> v_schedule.store_id then
    raise exception 'Schedule does not belong to shift store';
  end if;

  if v_shift.shift_type = 'open' then
    v_allowed_shift_types := array['am'];
  elsif v_shift.shift_type = 'close' then
    v_allowed_shift_types := array['pm'];
  elsif v_shift.shift_type = 'double' then
    v_allowed_shift_types := array['am', 'pm'];
  else
    raise exception 'No cleaning tasks for this shift type';
  end if;

  if not (v_schedule.shift_type = any(v_allowed_shift_types)) then
    raise exception 'Cleaning schedule shift type does not match shift';
  end if;

  if v_schedule.day_of_week <> extract(dow from v_shift.started_at at time zone 'America/Chicago')::int then
    raise exception 'Cleaning schedule day does not match shift day';
  end if;

  insert into public.cleaning_task_completions (
    shift_id,
    store_cleaning_schedule_id,
    status,
    completed_by,
    completed_at,
    skipped_reason
  )
  values (
    v_shift.id,
    v_schedule.id,
    'completed',
    p_actor_profile_id,
    now(),
    null
  )
  on conflict (shift_id, store_cleaning_schedule_id)
  do update set
    status = 'completed',
    completed_by = excluded.completed_by,
    completed_at = excluded.completed_at,
    skipped_reason = null;

  return true;
end;
$$;

revoke all on function public.complete_cleaning_task(uuid, uuid, uuid) from public;
revoke all on function public.complete_cleaning_task(uuid, uuid, uuid) from anon;
grant execute on function public.complete_cleaning_task(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.skip_cleaning_task(
  p_actor_profile_id uuid,
  p_shift_id uuid,
  p_schedule_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_shift public.shifts%rowtype;
  v_schedule public.store_cleaning_schedules%rowtype;
  v_task public.cleaning_tasks%rowtype;
  v_actor_is_manager boolean;
  v_actor_name text;
  v_allowed_shift_types text[];
  v_reason text;
begin
  v_reason := trim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Skip reason is required';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  if v_shift.ended_at is not null then
    raise exception 'Shift is not active';
  end if;

  select * into v_schedule
  from public.store_cleaning_schedules
  where id = p_schedule_id;

  if v_schedule.id is null then
    raise exception 'Cleaning schedule not found';
  end if;

  select * into v_task
  from public.cleaning_tasks
  where id = v_schedule.cleaning_task_id;

  if v_task.id is null then
    raise exception 'Cleaning task not found';
  end if;

  v_actor_is_manager := exists (
    select 1
    from public.profiles p
    join public.store_managers sm on sm.user_id = p.auth_user_id
    where p.id = p_actor_profile_id
      and sm.store_id = v_shift.store_id
  );

  if v_shift.profile_id <> p_actor_profile_id and not v_actor_is_manager then
    raise exception 'Actor not authorized for this shift';
  end if;

  if v_shift.store_id <> v_schedule.store_id then
    raise exception 'Schedule does not belong to shift store';
  end if;

  if v_shift.shift_type = 'open' then
    v_allowed_shift_types := array['am'];
  elsif v_shift.shift_type = 'close' then
    v_allowed_shift_types := array['pm'];
  elsif v_shift.shift_type = 'double' then
    v_allowed_shift_types := array['am', 'pm'];
  else
    raise exception 'No cleaning tasks for this shift type';
  end if;

  if not (v_schedule.shift_type = any(v_allowed_shift_types)) then
    raise exception 'Cleaning schedule shift type does not match shift';
  end if;

  if v_schedule.day_of_week <> extract(dow from v_shift.started_at at time zone 'America/Chicago')::int then
    raise exception 'Cleaning schedule day does not match shift day';
  end if;

  insert into public.cleaning_task_completions (
    shift_id,
    store_cleaning_schedule_id,
    status,
    completed_by,
    completed_at,
    skipped_reason
  )
  values (
    v_shift.id,
    v_schedule.id,
    'skipped',
    p_actor_profile_id,
    now(),
    v_reason
  )
  on conflict (shift_id, store_cleaning_schedule_id)
  do update set
    status = 'skipped',
    completed_by = excluded.completed_by,
    completed_at = excluded.completed_at,
    skipped_reason = excluded.skipped_reason;

  select coalesce(name, p_actor_profile_id::text)
    into v_actor_name
  from public.profiles
  where id = p_actor_profile_id;

  insert into public.shift_assignments (
    type,
    message,
    target_profile_id
  )
  select
    'message',
    v_actor_name || ' skipped ' || v_task.name || ' on ' ||
      to_char(v_shift.started_at at time zone 'America/Chicago', 'Mon DD') ||
      ' - Reason: ' || v_reason,
    p.id
  from public.store_managers sm
  join public.profiles p on p.auth_user_id = sm.user_id
  where sm.store_id = v_shift.store_id;

  return true;
end;
$$;

revoke all on function public.skip_cleaning_task(uuid, uuid, uuid, text) from public;
revoke all on function public.skip_cleaning_task(uuid, uuid, uuid, text) from anon;
grant execute on function public.skip_cleaning_task(uuid, uuid, uuid, text) to authenticated, service_role;
