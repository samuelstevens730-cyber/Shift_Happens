-- RLS hardening for payroll_advances (production-safe, idempotent).
-- Preflight (run manually before apply in production):
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class WHERE relname = 'payroll_advances';
--   SELECT tablename, policyname, cmd, roles
--   FROM pg_policies WHERE tablename = 'payroll_advances';
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'payroll_advances'
--   ORDER BY ordinal_position;

alter table if exists public.payroll_advances enable row level security;

drop policy if exists "payroll_advances_manager_select" on public.payroll_advances;
create policy "payroll_advances_manager_select"
on public.payroll_advances
for select
to authenticated
using (
  store_id in (
    select sm.store_id
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
);

drop policy if exists "payroll_advances_manager_insert" on public.payroll_advances;
create policy "payroll_advances_manager_insert"
on public.payroll_advances
for insert
to authenticated
with check (
  store_id in (
    select sm.store_id
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
);

drop policy if exists "payroll_advances_manager_update" on public.payroll_advances;
create policy "payroll_advances_manager_update"
on public.payroll_advances
for update
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

