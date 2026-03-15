-- RLS hardening for shift_change_audit_logs (production-safe, idempotent).
-- Preflight (run manually before apply in production):
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'shift_change_audit_logs';
--   SELECT tablename, policyname, cmd
--   FROM pg_policies WHERE tablename = 'shift_change_audit_logs';
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'shift_change_audit_logs'
--   ORDER BY ordinal_position;

alter table if exists public.shift_change_audit_logs enable row level security;

drop policy if exists "shift_change_audit_logs_manager_select" on public.shift_change_audit_logs;
create policy "shift_change_audit_logs_manager_select"
on public.shift_change_audit_logs
for select
to authenticated
using (
  store_id in (
    select sm.store_id
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
);

