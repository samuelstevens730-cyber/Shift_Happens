-- Backfill scheduled shifts so clock-window fallback logic does not treat them as manual.
-- Safe to re-run.

update public.shifts
set
  shift_source = 'scheduled',
  updated_at = now()
where schedule_shift_id is not null
  and coalesce(shift_source, 'manual') <> 'scheduled';
