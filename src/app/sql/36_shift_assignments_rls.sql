alter table public.shift_assignments enable row level security;

-- shift_assignments: employee read own messages/tasks
drop policy if exists "shift_assignments_employee_read" on public.shift_assignments;
create policy "shift_assignments_employee_read"
on public.shift_assignments
for select
using (
  target_profile_id is not null
  and (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = target_profile_id
);

-- shift_assignments: employee acknowledge own messages/tasks
drop policy if exists "shift_assignments_employee_ack" on public.shift_assignments;
create policy "shift_assignments_employee_ack"
on public.shift_assignments
for update
using (
  target_profile_id is not null
  and (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = target_profile_id
)
with check (
  target_profile_id is not null
  and (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid
    = target_profile_id
);

-- shift_assignments: manager read for their stores (via target store or membership)
drop policy if exists "shift_assignments_manager_read" on public.shift_assignments;
create policy "shift_assignments_manager_read"
on public.shift_assignments
for select
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.user_id = auth.uid()
      and (
        (target_store_id is not null and mm.store_id = target_store_id)
        or exists (
          select 1
          from public.store_memberships sm
          where sm.store_id = mm.store_id
            and sm.profile_id = target_profile_id
        )
      )
  )
);
