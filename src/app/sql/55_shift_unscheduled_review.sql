-- Allow managers to review/clear unscheduled shifts from action queues.

alter table public.shifts
  add column if not exists unscheduled_reviewed_at timestamptz,
  add column if not exists unscheduled_reviewed_by uuid,
  add column if not exists unscheduled_review_note text;

create index if not exists idx_shifts_unscheduled_review
  on public.shifts (store_id, unscheduled_reviewed_at, schedule_shift_id, started_at)
  where schedule_shift_id is null and started_at is not null;
