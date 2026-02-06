create or replace function public.process_expired_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_row public.shift_swap_requests%rowtype;
begin
  for v_row in
    select *
    from public.shift_swap_requests
    where status = 'open'
      and expires_at < now()
    for update skip locked
  loop
    update public.shift_swap_requests
    set status = 'expired',
        updated_at = now()
    where id = v_row.id;

    insert into public.request_audit_logs (
      request_type,
      request_id,
      action
    )
    values (
      'shift_swap',
      v_row.id,
      'request_expired'
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.process_expired_requests() from public;
revoke all on function public.process_expired_requests() from anon;
grant execute on function public.process_expired_requests() to authenticated, service_role;

create or replace function public.send_selection_nudges()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_row public.shift_swap_requests%rowtype;
begin
  for v_row in
    select r.*
    from public.shift_swap_requests r
    where r.status = 'open'
      and r.selected_offer_id is null
      and r.expires_at between now() and now() + interval '24 hours'
      and r.nudge_sent_at is null
      and exists (
        select 1
        from public.shift_swap_offers o
        where o.request_id = r.id
          and o.is_withdrawn = false
      )
    for update skip locked
  loop
    insert into public.shift_assignments (
      type,
      message,
      target_profile_id
    )
    values (
      'message',
      'Reminder: you have offers for a swap request. Please select one before it expires.',
      v_row.requester_profile_id
    );

    update public.shift_swap_requests
    set nudge_sent_at = now(),
        updated_at = now()
    where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.send_selection_nudges() from public;
revoke all on function public.send_selection_nudges() from anon;
grant execute on function public.send_selection_nudges() to authenticated, service_role;
