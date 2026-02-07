create or replace function public.submit_shift_swap_request(
  p_actor_profile_id uuid,
  p_schedule_shift_id uuid,
  p_reason text,
  p_expires_hours int default 48
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_store_id uuid;
  v_schedule_status text;
begin
  select ss.store_id, sc.status
    into v_store_id, v_schedule_status
  from public.schedule_shifts ss
  join public.schedules sc on sc.id = ss.schedule_id
  where ss.id = p_schedule_shift_id
    and ss.profile_id = p_actor_profile_id;

  if v_store_id is null then
    raise exception 'Shift not found or not owned by actor';
  end if;

  if v_schedule_status <> 'published' then
    raise exception 'Schedule is not published';
  end if;

  if exists (
    select 1
    from public.shift_swap_requests r
    where r.schedule_shift_id = p_schedule_shift_id
      and r.status in ('open','pending')
  ) then
    raise exception 'Shift already has an active swap request';
  end if;

  insert into public.shift_swap_requests (
    schedule_shift_id,
    store_id,
    requester_profile_id,
    reason,
    status,
    expires_at
  )
  values (
    p_schedule_shift_id,
    v_store_id,
    p_actor_profile_id,
    p_reason,
    'open',
    now() + (p_expires_hours::text || ' hours')::interval
  )
  returning id into v_request_id;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_profile_id
  )
  values (
    'shift_swap',
    v_request_id,
    'request_created',
    p_actor_profile_id
  );

  return v_request_id;
end;
$$;

revoke all on function public.submit_shift_swap_request(uuid, uuid, text, int) from public;
revoke all on function public.submit_shift_swap_request(uuid, uuid, text, int) from anon;
grant execute on function public.submit_shift_swap_request(uuid, uuid, text, int) to authenticated, service_role;

create or replace function public.submit_shift_swap_offer(
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_offer_type public.swap_offer_type,
  p_swap_schedule_shift_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer_id uuid;
  v_offerer_profile_id uuid;
  v_requester_profile_id uuid;
  v_store_id uuid;
  v_status public.request_status;
  v_actor_store_match boolean;
  v_offer_label text;
begin
  v_offerer_profile_id := p_actor_profile_id;

  select r.requester_profile_id, r.store_id, r.status
    into v_requester_profile_id, v_store_id, v_status
  from public.shift_swap_requests r
  where r.id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Swap request not found';
  end if;

  if v_status <> 'open' then
    raise exception 'Swap request is not open';
  end if;

  if v_requester_profile_id = p_actor_profile_id then
    raise exception 'Requester cannot submit an offer';
  end if;

  select exists (
    select 1
    from public.store_memberships sm
    where sm.store_id = v_store_id
      and sm.profile_id = p_actor_profile_id
  ) into v_actor_store_match;

  if not v_actor_store_match then
    raise exception 'Actor is not a member of this store';
  end if;

  if p_offer_type = 'swap' then
    if p_swap_schedule_shift_id is null then
      raise exception 'Swap offer requires swap_schedule_shift_id';
    end if;

    if not exists (
      select 1
      from public.schedule_shifts ss
      where ss.id = p_swap_schedule_shift_id
        and ss.profile_id = p_actor_profile_id
    ) then
      raise exception 'Swap schedule shift not owned by actor';
    end if;
  end if;

  insert into public.shift_swap_offers (
    request_id,
    offerer_profile_id,
    offer_type,
    swap_schedule_shift_id,
    note
  )
  values (
    p_request_id,
    p_actor_profile_id,
    p_offer_type,
    p_swap_schedule_shift_id,
    p_note
  )
  returning id into v_offer_id;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_profile_id
  )
  values (
    'shift_swap',
    p_request_id,
    'offer_submitted',
    p_actor_profile_id
  );

  v_offer_label := case when p_offer_type = 'cover' then 'cover' else 'swap' end;

  insert into public.shift_assignments (
    type,
    message,
    target_profile_id
  )
  values (
    'message',
    'New ' || v_offer_label || ' offer received on your shift swap request',
    v_requester_profile_id
  );

  insert into public.shift_assignments (
    type,
    message,
    target_profile_id
  )
  values (
    'message',
    'Your ' || v_offer_label || ' offer was submitted',
    v_offerer_profile_id
  );

  return v_offer_id;
end;
$$;

revoke all on function public.submit_shift_swap_offer(uuid, uuid, public.swap_offer_type, uuid, text) from public;
revoke all on function public.submit_shift_swap_offer(uuid, uuid, public.swap_offer_type, uuid, text) from anon;
grant execute on function public.submit_shift_swap_offer(uuid, uuid, public.swap_offer_type, uuid, text) to authenticated, service_role;

create or replace function public.select_shift_swap_offer(
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_offer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offerer_profile_id uuid;
  v_requester_profile_id uuid;
  v_store_id uuid;
  v_status public.request_status;
  v_offer_ok boolean;
begin
  select r.requester_profile_id, r.store_id, r.status
    into v_requester_profile_id, v_store_id, v_status
  from public.shift_swap_requests r
  where r.id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Swap request not found';
  end if;

  if v_requester_profile_id <> p_actor_profile_id then
    raise exception 'Actor does not own this request';
  end if;

  if v_status <> 'open' then
    raise exception 'Swap request is not open';
  end if;

  select exists (
    select 1
    from public.shift_swap_offers o
    where o.id = p_offer_id
      and o.request_id = p_request_id
  ) into v_offer_ok;

  if not v_offer_ok then
    raise exception 'Offer does not belong to request';
  end if;

  select o.offerer_profile_id
    into v_offerer_profile_id
  from public.shift_swap_offers o
  where o.id = p_offer_id
    and o.request_id = p_request_id;

  update public.shift_swap_offers
  set is_selected = false
  where request_id = p_request_id;

  update public.shift_swap_offers
  set is_selected = true
  where id = p_offer_id
    and request_id = p_request_id;

  update public.shift_swap_requests
  set selected_offer_id = p_offer_id,
      status = 'pending',
      updated_at = now()
  where id = p_request_id;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_profile_id
  )
  values (
    'shift_swap',
    p_request_id,
    'offer_selected',
    p_actor_profile_id
  );

  insert into public.shift_assignments (
    type,
    message,
    target_profile_id
  )
  select
    'message',
    'Swap request pending approval',
    p.id
  from public.store_managers sm
  join public.profiles p
    on p.auth_user_id = sm.user_id
  where sm.store_id = v_store_id;

  insert into public.shift_assignments (
    type,
    message,
    target_profile_id
  )
  values (
    'message',
    'Your offer was accepted and sent to management for approval',
    v_offerer_profile_id
  );

  -- Clear stale "new offer" notifications for requester once they act on an offer.
  update public.shift_assignments
  set acknowledged_at = now()
  where type = 'message'
    and target_profile_id = v_requester_profile_id
    and acknowledged_at is null
    and message like 'New % offer received on your shift swap request';

  return true;
end;
$$;

revoke all on function public.select_shift_swap_offer(uuid, uuid, uuid) from public;
revoke all on function public.select_shift_swap_offer(uuid, uuid, uuid) from anon;
grant execute on function public.select_shift_swap_offer(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.decline_shift_swap_offer(
  p_actor_profile_id uuid,
  p_request_id uuid,
  p_offer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_profile_id uuid;
  v_status public.request_status;
  v_offer_ok boolean;
  v_offerer_profile_id uuid;
begin
  select r.requester_profile_id, r.status
    into v_requester_profile_id, v_status
  from public.shift_swap_requests r
  where r.id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Swap request not found';
  end if;

  if v_requester_profile_id <> p_actor_profile_id then
    raise exception 'Actor does not own this request';
  end if;

  if v_status <> 'open' then
    raise exception 'Swap request is not open';
  end if;

  select exists (
    select 1
    from public.shift_swap_offers o
    where o.id = p_offer_id
      and o.request_id = p_request_id
      and o.is_selected = false
  ) into v_offer_ok;

  if not v_offer_ok then
    raise exception 'Offer does not belong to request or is already selected';
  end if;

  select o.offerer_profile_id
    into v_offerer_profile_id
  from public.shift_swap_offers o
  where o.id = p_offer_id
    and o.request_id = p_request_id;

  update public.shift_swap_offers
  set is_withdrawn = true
  where id = p_offer_id
    and request_id = p_request_id;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_profile_id
  )
  values (
    'shift_swap',
    p_request_id,
    'offer_denied',
    p_actor_profile_id
  );

  insert into public.shift_assignments (
    type,
    message,
    target_profile_id
  )
  values (
    'message',
    'Your offer was denied by the requester',
    v_offerer_profile_id
  );

  return true;
end;
$$;

revoke all on function public.decline_shift_swap_offer(uuid, uuid, uuid) from public;
revoke all on function public.decline_shift_swap_offer(uuid, uuid, uuid) from anon;
grant execute on function public.decline_shift_swap_offer(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.approve_shift_swap_or_cover(
  p_actor_auth_user_id uuid,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.shift_swap_requests%rowtype;
  v_offer public.shift_swap_offers%rowtype;
  v_request_shift public.schedule_shifts%rowtype;
  v_offer_shift public.schedule_shifts%rowtype;
  v_request_shift_label text;
  v_offer_shift_label text;
  v_requester_message text;
  v_offerer_message text;
  v_manager_ok boolean;
  v_conflict record;
begin
  select * into v_request
  from public.shift_swap_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Swap request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Swap request is not pending';
  end if;

  if v_request.selected_offer_id is null then
    raise exception 'No offer selected';
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

  select * into v_offer
  from public.shift_swap_offers
  where id = v_request.selected_offer_id
  for update;

  if v_offer.id is null then
    raise exception 'Selected offer not found';
  end if;

  select * into v_request_shift
  from public.schedule_shifts
  where id = v_request.schedule_shift_id
  for update;

  if v_request_shift.id is null then
    raise exception 'Schedule shift not found';
  end if;

  if v_request_shift.profile_id <> v_request.requester_profile_id then
    raise exception 'Request shift ownership changed';
  end if;

  if v_offer.offer_type = 'swap' then
    select * into v_offer_shift
    from public.schedule_shifts
    where id = v_offer.swap_schedule_shift_id
    for update;

    if v_offer_shift.id is null then
      raise exception 'Offer swap shift not found';
    end if;
  end if;

  for v_conflict in
    select * from public.check_bilocation_conflict(
      v_offer.offerer_profile_id,
      v_request_shift.shift_date,
      v_request_shift.scheduled_start,
      v_request_shift.scheduled_end,
      v_request_shift.id
    )
  loop
    raise exception 'Bilocation conflict for offerer';
  end loop;

  for v_conflict in
    select * from public.check_solo_coverage_conflict(
      v_request_shift.store_id,
      v_request_shift.shift_date,
      v_request_shift.shift_type,
      v_request_shift.scheduled_start,
      v_request_shift.scheduled_end,
      v_request_shift.id
    )
  loop
    raise exception 'Solo coverage conflict';
  end loop;

  if v_offer.offer_type = 'swap' then
    for v_conflict in
      select * from public.check_bilocation_conflict(
        v_request.requester_profile_id,
        v_offer_shift.shift_date,
        v_offer_shift.scheduled_start,
        v_offer_shift.scheduled_end,
        v_offer_shift.id
      )
    loop
      raise exception 'Bilocation conflict for requester';
    end loop;
  end if;

  if v_offer.offer_type = 'swap' then
    update public.schedule_shifts
    set profile_id = v_offer.offerer_profile_id
    where id = v_request_shift.id;

    update public.schedule_shifts
    set profile_id = v_request.requester_profile_id
    where id = v_offer_shift.id;
  else
    update public.schedule_shifts
    set profile_id = v_offer.offerer_profile_id
    where id = v_request_shift.id;
  end if;

  update public.shift_swap_requests
  set status = 'approved',
      approved_by = p_actor_auth_user_id,
      approved_at = now(),
      updated_at = now()
  where id = v_request.id;

  v_request_shift_label :=
    to_char(v_request_shift.shift_date, 'Mon DD') || ' ' ||
    to_char(v_request_shift.scheduled_start, 'HH12:MI AM') || ' - ' ||
    to_char(v_request_shift.scheduled_end, 'HH12:MI AM');

  if v_offer.offer_type = 'swap' then
    v_offer_shift_label :=
      to_char(v_offer_shift.shift_date, 'Mon DD') || ' ' ||
      to_char(v_offer_shift.scheduled_start, 'HH12:MI AM') || ' - ' ||
      to_char(v_offer_shift.scheduled_end, 'HH12:MI AM');
    v_requester_message := 'Your shift swap request was approved. Your new shift is ' || v_offer_shift_label || '.';
    v_offerer_message := 'Your shift swap offer was approved. Your new shift is ' || v_request_shift_label || '.';
  else
    v_requester_message := 'Your shift cover request was approved. The shift on ' || v_request_shift_label || ' is now covered.';
    v_offerer_message := 'Your cover offer was approved. Your new shift is ' || v_request_shift_label || '.';
  end if;

  insert into public.request_audit_logs (
    request_type,
    request_id,
    action,
    actor_auth_user_id
  )
  values (
    'shift_swap',
    v_request.id,
    'request_approved',
    p_actor_auth_user_id
  );

  insert into public.shift_assignments (
    type,
    message,
    target_profile_id
  )
  values
    ('message', v_requester_message, v_request.requester_profile_id),
    ('message', v_offerer_message, v_offer.offerer_profile_id);

  return true;
end;
$$;

revoke all on function public.approve_shift_swap_or_cover(uuid, uuid) from public;
revoke all on function public.approve_shift_swap_or_cover(uuid, uuid) from anon;
grant execute on function public.approve_shift_swap_or_cover(uuid, uuid) to authenticated, service_role;

create or replace function public.cancel_shift_swap_request(
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
  from public.shift_swap_requests r
  where r.id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Swap request not found';
  end if;

  if v_requester_profile_id <> p_actor_profile_id then
    raise exception 'Actor does not own this request';
  end if;

  if v_status not in ('open','pending') then
    raise exception 'Swap request cannot be cancelled';
  end if;

  update public.shift_swap_requests
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
    'shift_swap',
    p_request_id,
    'request_cancelled',
    p_actor_profile_id
  );

  return true;
end;
$$;

revoke all on function public.cancel_shift_swap_request(uuid, uuid) from public;
revoke all on function public.cancel_shift_swap_request(uuid, uuid) from anon;
grant execute on function public.cancel_shift_swap_request(uuid, uuid) to authenticated, service_role;
