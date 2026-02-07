-- Fix manager read policy for request_audit_logs.
-- Managers can read logs for requests in stores they manage by joining to request tables.

drop policy if exists "request_audit_logs_manager_read" on public.request_audit_logs;

create policy "request_audit_logs_manager_read"
on public.request_audit_logs
for select
using (
  exists (
    select 1
    from public.store_managers sm
    where sm.user_id = auth.uid()
      and (
        (request_type = 'shift_swap' and exists (
          select 1
          from public.shift_swap_requests r
          where r.id = request_id
            and sm.store_id = r.store_id
        ))
        or
        (request_type = 'time_off' and exists (
          select 1
          from public.time_off_requests r
          where r.id = request_id
            and sm.store_id = r.store_id
        ))
        or
        (request_type = 'timesheet' and exists (
          select 1
          from public.timesheet_change_requests r
          where r.id = request_id
            and sm.store_id = r.store_id
        ))
      )
  )
);

