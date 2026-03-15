-- RLS hardening for shift_sales_counts (production-safe, idempotent).
-- Preflight (run manually before apply in production):
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'shift_sales_counts';
--   SELECT tablename, policyname, cmd
--   FROM pg_policies WHERE tablename = 'shift_sales_counts';
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'shift_sales_counts'
--   ORDER BY ordinal_position;

alter table if exists public.shift_sales_counts enable row level security;

drop policy if exists "shift_sales_counts_manager_select" on public.shift_sales_counts;
create policy "shift_sales_counts_manager_select"
on public.shift_sales_counts
for select
to authenticated
using (
  exists (
    select 1
    from public.shifts s
    where s.id = shift_sales_counts.shift_id
      and s.store_id in (
        select sm.store_id
        from public.store_managers sm
        where sm.user_id = auth.uid()
      )
  )
);

