-- RLS hardening for shift_checklist_checks (production-safe, idempotent).
-- Preflight (run manually before apply in production):
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'shift_checklist_checks';
--   SELECT tablename, policyname, cmd
--   FROM pg_policies WHERE tablename = 'shift_checklist_checks';
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'shift_checklist_checks'
--   ORDER BY ordinal_position;

alter table if exists public.shift_checklist_checks enable row level security;

drop policy if exists "shift_checklist_checks_employee_select_own" on public.shift_checklist_checks;
create policy "shift_checklist_checks_employee_select_own"
on public.shift_checklist_checks
for select
to authenticated
using (
  exists (
    select 1
    from public.shifts s
    where s.id = shift_checklist_checks.shift_id
      and s.profile_id = (
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
      )::uuid
  )
);

drop policy if exists "shift_checklist_checks_employee_insert_own" on public.shift_checklist_checks;
create policy "shift_checklist_checks_employee_insert_own"
on public.shift_checklist_checks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.shifts s
    where s.id = shift_checklist_checks.shift_id
      and s.profile_id = (
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
      )::uuid
  )
);

drop policy if exists "shift_checklist_checks_employee_update_own" on public.shift_checklist_checks;
create policy "shift_checklist_checks_employee_update_own"
on public.shift_checklist_checks
for update
to authenticated
using (
  exists (
    select 1
    from public.shifts s
    where s.id = shift_checklist_checks.shift_id
      and s.profile_id = (
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
      )::uuid
  )
)
with check (
  exists (
    select 1
    from public.shifts s
    where s.id = shift_checklist_checks.shift_id
      and s.profile_id = (
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
      )::uuid
  )
);

drop policy if exists "shift_checklist_checks_manager_select" on public.shift_checklist_checks;
create policy "shift_checklist_checks_manager_select"
on public.shift_checklist_checks
for select
to authenticated
using (
  exists (
    select 1
    from public.shifts s
    where s.id = shift_checklist_checks.shift_id
      and s.store_id in (
        select sm.store_id
        from public.store_managers sm
        where sm.user_id = auth.uid()
      )
  )
);

