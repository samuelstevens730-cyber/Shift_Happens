-- RLS policies for schedules and schedule_shifts (manager + employee read)

alter table public.shift_templates enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_shifts enable row level security;

-- shift_templates: managers can read/write templates for their stores.
drop policy if exists "shift_templates_manager_all" on public.shift_templates;
create policy "shift_templates_manager_all"
on public.shift_templates
for all
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
);

-- schedules: managers can CRUD schedules for their stores.
drop policy if exists "schedules_manager_all" on public.schedules;
create policy "schedules_manager_all"
on public.schedules
for all
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
);

-- schedules: employees can read published schedules for their stores (JWT store_ids).
drop policy if exists "schedules_employee_read" on public.schedules;
create policy "schedules_employee_read"
on public.schedules
for select
using (
  status = 'published'
  and (
    (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->'store_ids')::jsonb
      ? store_id::text
  )
);

-- schedule_shifts: managers can CRUD for their stores.
drop policy if exists "schedule_shifts_manager_all" on public.schedule_shifts;
create policy "schedule_shifts_manager_all"
on public.schedule_shifts
for all
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.store_managers mm
    where mm.store_id = store_id and mm.user_id = auth.uid()
  )
);

-- schedule_shifts: employees can read their own shifts in published schedules.
drop policy if exists "schedule_shifts_employee_read" on public.schedule_shifts;
create policy "schedule_shifts_employee_read"
on public.schedule_shifts
for select
using (
  (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id')::uuid = profile_id
  and exists (
    select 1
    from public.schedules s
    where s.id = schedule_id
      and s.status = 'published'
  )
);
