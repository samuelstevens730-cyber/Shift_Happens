create or replace function public.submit_timesheet_change_request(
  p_actor_profile_id uuid,
  p_shift_id uuid,
  p_requested_started_at timestamptz,
  p_requested_ended_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_shift public.shifts%rowtype;
  v_lock record;
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id
    and profile_id = p_actor_profile_id
  for update;

  if v_shift.id is null then
    raise exception 'Shift not found or not owned by actor';
  end if;

  if p_requested_started_at is null and p_requested_ended_at is null then
    raise exception 'At least one change must be requested';
  end if;

  if (p_requested_started_at is null or p_requested_started_at = v_shift.started_at)
     and (p_requested_ended_at is null or p_requested_ended_at = v_shift.ended_at) then
    raise exception 'No changes requested';
  end if;

  select * into v_lock
  from public.check_payroll_lock(v_shift.started_at);

  if v_lock.is_locked then
    raise exception 'Payroll period is locked';
  end if;

  insert into public.timesheet_change_requests (
    shift_id,
    store_id,
    requester_profile_id,
    requested_started_at,
    requested_ended_at,
    original_started_at,
    original_ended_at,
    reason,
    status
  )
  values (
    v_shift.id,
    v_shift.store_id,
    p_actor_profile_id,
    p_requested_started_at,
    p_requested_ended_at,
    v_shift.started_at,
    v_shift.ended_at,
    p_reason,
    'pending'
  )
  returning id into v_request_id;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_profile_id
  )
  values (
    'timesheet',
    v_request_id,
    'request_created',
    p_actor_profile_id
  );

  return v_request_id;
end;
$$;

revoke all on function public.submit_timesheet_change_request(uuid, uuid, timestamptz, timestamptz, text) from public;
revoke all on function public.submit_timesheet_change_request(uuid, uuid, timestamptz, timestamptz, text) from anon;
grant execute on function public.submit_timesheet_change_request(uuid, uuid, timestamptz, timestamptz, text) to authenticated, service_role;

create or replace function public.approve_timesheet_change_request(
  p_actor_auth_user_id uuid,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.timesheet_change_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_manager_ok boolean;
  v_snapshot jsonb;
begin
  select * into v_request
  from public.timesheet_change_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Timesheet request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Timesheet request is not pending';
  end if;

  select * into v_shift
  from public.shifts
  where id = v_request.shift_id
  for update;

  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  select exists (
    select 1
    from public.store_managers sm
    where sm.store_id = v_request.store_id
      and sm.user_id = p_actor_auth_user_id
  ) into v_manager_ok;

  if not v_manager_ok then
    raise exception 'Manager not authorized for this store';
  end if;

  if v_request.original_started_at is distinct from v_shift.started_at
     or v_request.original_ended_at is distinct from v_shift.ended_at then
    raise exception 'Timesheet request is stale';
  end if;

  v_snapshot := jsonb_build_object(
    'before', jsonb_build_object(
      'started_at', v_shift.started_at,
      'ended_at', v_shift.ended_at
    ),
    'after', jsonb_build_object(
      'started_at', coalesce(v_request.requested_started_at, v_shift.started_at),
      'ended_at', coalesce(v_request.requested_ended_at, v_shift.ended_at)
    )
  );

  update public.shifts
  set started_at = coalesce(v_request.requested_started_at, v_shift.started_at),
      ended_at = coalesce(v_request.requested_ended_at, v_shift.ended_at),
      last_action = 'edited',
      last_action_by = p_actor_auth_user_id
  where id = v_shift.id;

  update public.timesheet_change_requests
  set status = 'approved',
      reviewed_by = p_actor_auth_user_id,
      reviewed_at = now(),
      updated_at = now()
  where id = v_request.id;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_auth_user_id,
    snapshot
  )
  values (
    'timesheet',
    v_request.id,
    'timesheet_corrected',
    p_actor_auth_user_id,
    v_snapshot
  );

  return true;
end;
$$;

revoke all on function public.approve_timesheet_change_request(uuid, uuid) from public;
revoke all on function public.approve_timesheet_change_request(uuid, uuid) from anon;
grant execute on function public.approve_timesheet_change_request(uuid, uuid) to authenticated, service_role;

create or replace function public.cancel_timesheet_change_request(
  p_actor_profile_id uuid,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_profile_id uuid;
  v_status public.request_status;
begin
  select r.requester_profile_id, r.status
    into v_requester_profile_id, v_status
  from public.timesheet_change_requests r
  where r.id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Timesheet request not found';
  end if;

  if v_requester_profile_id <> p_actor_profile_id then
    raise exception 'Actor does not own this request';
  end if;

  if v_status <> 'pending' then
    raise exception 'Timesheet request cannot be cancelled';
  end if;

  update public.timesheet_change_requests
  set status = 'cancelled',
      updated_at = now()
  where id = p_request_id;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_profile_id
  )
  values (
    'timesheet',
    p_request_id,
    'request_cancelled',
    p_actor_profile_id
  );

  return true;
end;
$$;

revoke all on function public.cancel_timesheet_change_request(uuid, uuid) from public;
revoke all on function public.cancel_timesheet_change_request(uuid, uuid) from anon;
grant execute on function public.cancel_timesheet_change_request(uuid, uuid) to authenticated, service_role;
