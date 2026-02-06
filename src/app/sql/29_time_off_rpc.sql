create or replace function public.submit_time_off_request(
  p_actor_profile_id uuid,
  p_store_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_member_ok boolean;
  v_conflict record;
begin
  if p_end_date < p_start_date then
    raise exception 'End date must be on or after start date';
  end if;

  select exists (
    select 1
    from public.store_memberships sm
    where sm.store_id = p_store_id
      and sm.profile_id = p_actor_profile_id
  ) into v_member_ok;

  if not v_member_ok then
    raise exception 'Actor is not a member of this store';
  end if;

  for v_conflict in
    select * from public.check_time_off_schedule_conflict(
      p_actor_profile_id,
      p_start_date,
      p_end_date
    )
  loop
    raise exception 'Time off conflicts with a published shift';
  end loop;

  insert into public.time_off_requests (
    store_id,
    profile_id,
    start_date,
    end_date,
    reason,
    status
  )
  values (
    p_store_id,
    p_actor_profile_id,
    p_start_date,
    p_end_date,
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
    'time_off',
    v_request_id,
    'request_created',
    p_actor_profile_id
  );

  return v_request_id;
end;
$$;

revoke all on function public.submit_time_off_request(uuid, uuid, date, date, text) from public;
revoke all on function public.submit_time_off_request(uuid, uuid, date, date, text) from anon;
grant execute on function public.submit_time_off_request(uuid, uuid, date, date, text) to authenticated, service_role;

create or replace function public.approve_time_off_request(
  p_actor_auth_user_id uuid,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.time_off_requests%rowtype;
  v_block_id uuid;
  v_manager_ok boolean;
begin
  select * into v_request
  from public.time_off_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Time off request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Time off request is not pending';
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

  insert into public.time_off_blocks (
    profile_id,
    start_date,
    end_date,
    request_id,
    created_by
  )
  values (
    v_request.profile_id,
    v_request.start_date,
    v_request.end_date,
    v_request.id,
    p_actor_auth_user_id
  )
  returning id into v_block_id;

  update public.time_off_requests
  set status = 'approved',
      reviewed_by = p_actor_auth_user_id,
      reviewed_at = now(),
      updated_at = now()
  where id = v_request.id;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_auth_user_id
  )
  values (
    'time_off',
    v_request.id,
    'request_approved',
    p_actor_auth_user_id
  );

  return v_block_id;
end;
$$;

revoke all on function public.approve_time_off_request(uuid, uuid) from public;
revoke all on function public.approve_time_off_request(uuid, uuid) from anon;
grant execute on function public.approve_time_off_request(uuid, uuid) to authenticated, service_role;

create or replace function public.cancel_time_off_request(
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
  select r.profile_id, r.status
    into v_requester_profile_id, v_status
  from public.time_off_requests r
  where r.id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Time off request not found';
  end if;

  if v_requester_profile_id <> p_actor_profile_id then
    raise exception 'Actor does not own this request';
  end if;

  if v_status <> 'pending' then
    raise exception 'Time off request cannot be cancelled';
  end if;

  update public.time_off_requests
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
    'time_off',
    p_request_id,
    'request_cancelled',
    p_actor_profile_id
  );

  return true;
end;
$$;

revoke all on function public.cancel_time_off_request(uuid, uuid) from public;
revoke all on function public.cancel_time_off_request(uuid, uuid) from anon;
grant execute on function public.cancel_time_off_request(uuid, uuid) to authenticated, service_role;
