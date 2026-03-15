-- RLS hardening for store_cleaning_schedules (production-safe, idempotent).
-- Preflight (run manually before apply in production):
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'store_cleaning_schedules';
--   SELECT tablename, policyname, cmd
--   FROM pg_policies WHERE tablename = 'store_cleaning_schedules';
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'store_cleaning_schedules'
--   ORDER BY ordinal_position;

alter table if exists public.store_cleaning_schedules enable row level security;

drop policy if exists "store_cleaning_schedules_manager_all" on public.store_cleaning_schedules;
create policy "store_cleaning_schedules_manager_all"
on public.store_cleaning_schedules
for all
to authenticated
using (
  store_id in (
    select sm.store_id
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
)
with check (
  store_id in (
    select sm.store_id
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
);

drop policy if exists "store_cleaning_schedules_employee_select" on public.store_cleaning_schedules;
create policy "store_cleaning_schedules_employee_select"
on public.store_cleaning_schedules
for select
to authenticated
using (
  (
    (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->'store_ids')::jsonb
  ) ? store_id::text
);

