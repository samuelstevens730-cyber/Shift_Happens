alter table public.shift_swap_requests enable row level security;
alter table public.shift_swap_offers enable row level security;
alter table public.time_off_requests enable row level security;
alter table public.time_off_blocks enable row level security;
alter table public.timesheet_change_requests enable row level security;
alter table public.request_audit_logs enable row level security;

-- shift_swap_requests: employee read own requests
drop policy if exists "shift_swap_requests_employee_read" on public.shift_swap_requests;
create policy "shift_swap_requests_employee_read"
on public.shift_swap_requests
for select
using (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = requester_profile_id
);

-- shift_swap_requests: manager read for their stores
drop policy if exists "shift_swap_requests_manager_read" on public.shift_swap_requests;
create policy "shift_swap_requests_manager_read"
on public.shift_swap_requests
for select
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id
      and mm.user_id = auth.uid()
  )
);

-- shift_swap_offers: employee read own offers OR offers on their requests
drop policy if exists "shift_swap_offers_employee_read" on public.shift_swap_offers;
create policy "shift_swap_offers_employee_read"
on public.shift_swap_offers
for select
using (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = offerer_profile_id
  or exists (
    select 1
    from public.shift_swap_requests r
    where r.id = request_id
      and r.requester_profile_id = (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
  )
);

-- shift_swap_offers: manager read via request store_id
drop policy if exists "shift_swap_offers_manager_read" on public.shift_swap_offers;
create policy "shift_swap_offers_manager_read"
on public.shift_swap_offers
for select
using (
  exists (
    select 1
    from public.shift_swap_requests r
    join public.store_managers mm on mm.store_id = r.store_id
    where r.id = request_id
      and mm.user_id = auth.uid()
  )
);

-- time_off_requests: employee read own requests
drop policy if exists "time_off_requests_employee_read" on public.time_off_requests;
create policy "time_off_requests_employee_read"
on public.time_off_requests
for select
using (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = profile_id
);

-- time_off_requests: manager read for their stores
drop policy if exists "time_off_requests_manager_read" on public.time_off_requests;
create policy "time_off_requests_manager_read"
on public.time_off_requests
for select
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id
      and mm.user_id = auth.uid()
  )
);

-- time_off_blocks: employee read own blocks
drop policy if exists "time_off_blocks_employee_read" on public.time_off_blocks;
create policy "time_off_blocks_employee_read"
on public.time_off_blocks
for select
using (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = profile_id
);

-- time_off_blocks: manager read via profile membership
drop policy if exists "time_off_blocks_manager_read" on public.time_off_blocks;
create policy "time_off_blocks_manager_read"
on public.time_off_blocks
for select
using (
  exists (
    select 1
    from public.store_memberships sm
    join public.store_managers mm on mm.store_id = sm.store_id
    where sm.profile_id = profile_id
      and mm.user_id = auth.uid()
  )
);

-- timesheet_change_requests: employee read own requests
drop policy if exists "timesheet_change_requests_employee_read" on public.timesheet_change_requests;
create policy "timesheet_change_requests_employee_read"
on public.timesheet_change_requests
for select
using (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = requester_profile_id
);

-- timesheet_change_requests: manager read for their stores
drop policy if exists "timesheet_change_requests_manager_read" on public.timesheet_change_requests;
create policy "timesheet_change_requests_manager_read"
on public.timesheet_change_requests
for select
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id
      and mm.user_id = auth.uid()
  )
);

-- request_audit_logs: employee read own actions
drop policy if exists "request_audit_logs_employee_read" on public.request_audit_logs;
create policy "request_audit_logs_employee_read"
on public.request_audit_logs
for select
using (
  actor_profile_id is not null
  and (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = actor_profile_id
);

-- request_audit_logs: manager read actions by profiles they manage
drop policy if exists "request_audit_logs_manager_read" on public.request_audit_logs;
create policy "request_audit_logs_manager_read"
on public.request_audit_logs
for select
using (
  actor_profile_id is not null
  and exists (
    select 1
    from public.store_memberships sm
    join public.store_managers mm on mm.store_id = sm.store_id
    where sm.profile_id = actor_profile_id
      and mm.user_id = auth.uid()
  )
);
