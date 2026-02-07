-- Patch deny_request to notify all affected offerers when a swap is denied by management.
-- Note: shift_swap_offers has no status column in current schema, so "void" is represented
-- by setting is_withdrawn = true and is_selected = false for active offers.

create or replace function public.deny_request(
  p_actor_auth_user_id uuid,
  p_request_type text,
  p_request_id uuid,
  p_denial_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager_ok boolean;
begin
  if p_request_type = 'shift_swap' then
    declare
      v_request public.shift_swap_requests%rowtype;
      v_selected_offerer_profile_id uuid;
      v_selected_offerer_name text;
      v_selected_offer_id uuid;
      v_requester_name text;
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

      select exists (
        select 1
        from public.store_managers sm
        where sm.store_id = v_request.store_id
          and sm.user_id = p_actor_auth_user_id
      ) into v_manager_ok;

      if not v_manager_ok then
        raise exception 'Manager not authorized for this store';
      end if;

      -- Capture selected offer before clearing request selection.
      v_selected_offer_id := v_request.selected_offer_id;

      select o.offerer_profile_id
        into v_selected_offerer_profile_id
      from public.shift_swap_offers o
      where o.id = v_selected_offer_id;

      select p.name
        into v_requester_name
      from public.profiles p
      where p.id = v_request.requester_profile_id;

      if v_requester_name is null then
        raise exception 'Requester profile not found';
      end if;

      if v_selected_offerer_profile_id is not null then
        select p.name
          into v_selected_offerer_name
        from public.profiles p
        where p.id = v_selected_offerer_profile_id;
      end if;

      -- Reopen request for future offers.
      update public.shift_swap_requests
      set status = 'open',
          selected_offer_id = null,
          denial_reason = p_denial_reason,
          updated_at = now()
      where id = v_request.id;

      -- Notify all non-withdrawn, non-selected offerers before voiding active offers.
      insert into public.shift_assignments (
        type,
        message,
        target_profile_id
      )
      select
        'message',
        'Management denied ' || v_requester_name || '''s swap request. Your offer is no longer active.',
        o.offerer_profile_id
      from public.shift_swap_offers o
      where o.request_id = v_request.id
        and o.is_withdrawn = false
        and (v_selected_offer_id is null or o.id <> v_selected_offer_id);

      -- Void all active offers on this request.
      update public.shift_swap_offers
      set is_selected = false,
          is_withdrawn = true
      where request_id = v_request.id
        and is_withdrawn = false;

      -- Clear stale requester notifications.
      update public.shift_assignments
      set acknowledged_at = now()
      where type = 'message'
        and target_profile_id = v_request.requester_profile_id
        and acknowledged_at is null
        and message like 'New % offer received on your shift swap request';

      -- Notify requester that request is open again.
      insert into public.shift_assignments (
        type,
        message,
        target_profile_id
      )
      values (
        'message',
        'Management denied the selected offer from ' || coalesce(v_selected_offerer_name, 'an offerer') || '. Your request is open again.',
        v_request.requester_profile_id
      );

      -- Notify selected offerer with specific context.
      if v_selected_offerer_profile_id is not null then
        insert into public.shift_assignments (
          type,
          message,
          target_profile_id
        )
        values (
          'message',
          'Management denied ' || v_requester_name || '''s request after selecting your offer.',
          v_selected_offerer_profile_id
        );
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
        'request_denied',
        p_actor_auth_user_id
      );

      return true;
    end;

  elsif p_request_type = 'time_off' then
    declare
      v_request public.time_off_requests%rowtype;
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

      update public.time_off_requests
      set status = 'denied',
          denial_reason = p_denial_reason,
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
        'request_denied',
        p_actor_auth_user_id
      );

      return true;
    end;

  elsif p_request_type = 'timesheet' then
    declare
      v_request public.timesheet_change_requests%rowtype;
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

      select exists (
        select 1
        from public.store_managers sm
        where sm.store_id = v_request.store_id
          and sm.user_id = p_actor_auth_user_id
      ) into v_manager_ok;

      if not v_manager_ok then
        raise exception 'Manager not authorized for this store';
      end if;

      update public.timesheet_change_requests
      set status = 'denied',
          denial_reason = p_denial_reason,
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
        'timesheet',
        v_request.id,
        'request_denied',
        p_actor_auth_user_id
      );

      return true;
    end;

  else
    raise exception 'Unknown request type';
  end if;
end;
$$;

revoke all on function public.deny_request(uuid, text, uuid, text) from public;
revoke all on function public.deny_request(uuid, text, uuid, text) from anon;
grant execute on function public.deny_request(uuid, text, uuid, text) to authenticated, service_role;
