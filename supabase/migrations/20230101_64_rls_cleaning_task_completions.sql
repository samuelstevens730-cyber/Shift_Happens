-- RLS hardening for cleaning_task_completions (production-safe, idempotent).
-- Preflight (run manually before apply in production):
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'cleaning_task_completions';
--   SELECT tablename, policyname, cmd
--   FROM pg_policies WHERE tablename = 'cleaning_task_completions';
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'cleaning_task_completions'
--   ORDER BY ordinal_position;

alter table if exists public.cleaning_task_completions enable row level security;

drop policy if exists "cleaning_task_completions_employee_select_own" on public.cleaning_task_completions;
create policy "cleaning_task_completions_employee_select_own"
on public.cleaning_task_completions
for select
to authenticated
using (
  exists (
    select 1
    from public.shifts s
    where s.id = cleaning_task_completions.shift_id
      and s.profile_id = (
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
      )::uuid
  )
);

drop policy if exists "cleaning_task_completions_employee_insert_own" on public.cleaning_task_completions;
create policy "cleaning_task_completions_employee_insert_own"
on public.cleaning_task_completions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.shifts s
    where s.id = cleaning_task_completions.shift_id
      and s.profile_id = (
        coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json->>'profile_id'
      )::uuid
  )
);

drop policy if exists "cleaning_task_completions_manager_select" on public.cleaning_task_completions;
create policy "cleaning_task_completions_manager_select"
on public.cleaning_task_completions
for select
to authenticated
using (
  exists (
    select 1
    from public.shifts s
    where s.id = cleaning_task_completions.shift_id
      and s.store_id in (
        select sm.store_id
        from public.store_managers sm
        where sm.user_id = auth.uid()
      )
  )
);

