-- Payroll reconciliation thresholds
-- Adds tunable warning thresholds used by admin payroll reconciliation reports.

alter table if exists public.store_settings
  add column if not exists payroll_variance_warn_hours numeric(6,2) not null default 2,
  add column if not exists payroll_shift_drift_warn_hours numeric(6,2) not null default 2;

