-- Backfill historical shifts so "actual logged in" matches the manual clock-in
-- time employees entered (stored in planned_start_at).
--
-- Why:
-- - Older behavior stored started_at as submission timestamp.
-- - Payroll/reconciliation now standardize on manual entered clock-in/out.
--
-- Safe approach:
-- 1) Run the preview queries first.
-- 2) Run the UPDATE inside a transaction.
-- 3) Verify before COMMIT.

-- =========================================================
-- Preview 1: how many completed, non-removed shifts differ?
-- =========================================================
select count(*) as candidate_count
from public.shifts s
where s.ended_at is not null
  and coalesce(s.last_action, '') <> 'removed'
  and s.started_at is not null
  and s.planned_start_at is not null
  and s.started_at is distinct from s.planned_start_at;

-- =========================================================
-- Preview 2: sample rows (largest drifts first)
-- =========================================================
select
  s.id,
  s.store_id,
  s.profile_id,
  s.shift_type,
  s.planned_start_at,
  s.started_at,
  round(abs(extract(epoch from (s.started_at - s.planned_start_at))) / 60.0, 2) as drift_minutes
from public.shifts s
where s.ended_at is not null
  and coalesce(s.last_action, '') <> 'removed'
  and s.started_at is not null
  and s.planned_start_at is not null
  and s.started_at is distinct from s.planned_start_at
order by drift_minutes desc
limit 100;

-- =========================================================
-- Apply (recommended with explicit date window)
-- Replace the date window if you want a narrower backfill.
-- =========================================================
begin;

update public.shifts s
set
  started_at = s.planned_start_at,
  updated_at = now()
where s.ended_at is not null
  and coalesce(s.last_action, '') <> 'removed'
  and s.started_at is not null
  and s.planned_start_at is not null
  and s.started_at is distinct from s.planned_start_at
  and s.planned_start_at >= '2025-01-01T00:00:00Z'::timestamptz;

-- Verify updated rows quickly before commit:
select count(*) as remaining_mismatches
from public.shifts s
where s.ended_at is not null
  and coalesce(s.last_action, '') <> 'removed'
  and s.started_at is not null
  and s.planned_start_at is not null
  and s.started_at is distinct from s.planned_start_at
  and s.planned_start_at >= '2025-01-01T00:00:00Z'::timestamptz;

commit;
