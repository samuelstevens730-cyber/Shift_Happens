-- RLS hardening for daily_sales_records (production-safe, idempotent).
-- Preflight (run manually before apply in production):
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'daily_sales_records';
--   SELECT tablename, policyname, cmd
--   FROM pg_policies WHERE tablename = 'daily_sales_records';
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'daily_sales_records'
--   ORDER BY ordinal_position;

alter table if exists public.daily_sales_records enable row level security;

drop policy if exists "daily_sales_records_manager_select" on public.daily_sales_records;
create policy "daily_sales_records_manager_select"
on public.daily_sales_records
for select
to authenticated
using (
  store_id in (
    select sm.store_id
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
);

