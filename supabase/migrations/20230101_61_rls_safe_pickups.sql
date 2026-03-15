-- RLS hardening for safe_pickups (production-safe, idempotent).
-- NOTE: recorded_by is auth.users.id (not profile_id).
-- Preflight (run manually before apply in production):
--   SELECT relname, relrowsecurity
--   FROM pg_class WHERE relname = 'safe_pickups';
--   SELECT tablename, policyname, cmd
--   FROM pg_policies WHERE tablename = 'safe_pickups';
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'safe_pickups'
--   ORDER BY ordinal_position;

alter table if exists public.safe_pickups enable row level security;

drop policy if exists "safe_pickups_manager_select" on public.safe_pickups;
create policy "safe_pickups_manager_select"
on public.safe_pickups
for select
to authenticated
using (
  store_id in (
    select sm.store_id
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
);

drop policy if exists "safe_pickups_manager_insert" on public.safe_pickups;
create policy "safe_pickups_manager_insert"
on public.safe_pickups
for insert
to authenticated
with check (
  store_id in (
    select sm.store_id
    from public.store_managers sm
    where sm.user_id = auth.uid()
  )
);

