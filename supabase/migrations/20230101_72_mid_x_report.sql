-- 72_mid_x_report.sql
--
-- Adds mid_x_report_cents to daily_sales_records.
--
-- PURPOSE:
--   Records the mid-day X report total entered at the changeover panel for
--   double shifts. Enables accurate AM/PM sales and transaction count splits:
--     AM sales = mid_x_report_cents - open_x_report_cents
--     PM sales = z_report_cents - mid_x_report_cents + rollover
--
-- IDEMPOTENCY (same pattern as 71_transaction_counts.sql):
--   ADD COLUMN IF NOT EXISTS (no inline CONSTRAINT — skips silently if column
--   already exists, which also skips any inline constraint clause).
--   Separate DROP/ADD constraint blocks guarantee the check is always present.

-- Step 1: add column (no-op if it already exists)
ALTER TABLE public.daily_sales_records
  ADD COLUMN IF NOT EXISTS mid_x_report_cents INTEGER NULL;

-- Step 2: add check constraint idempotently
--   PREFLIGHT (run before applying this migration if the column may already
--   exist with data — the ADD CONSTRAINT will fail if any rows violate it):
--
--     SELECT COUNT(*) FROM public.daily_sales_records WHERE mid_x_report_cents < 0;
--
--   Query must return 0 before proceeding.
ALTER TABLE public.daily_sales_records
  DROP CONSTRAINT IF EXISTS chk_mid_x_report_cents_nn;
ALTER TABLE public.daily_sales_records
  ADD CONSTRAINT chk_mid_x_report_cents_nn CHECK (mid_x_report_cents >= 0);

-- Step 3: column comment
COMMENT ON COLUMN public.daily_sales_records.mid_x_report_cents IS
  'Mid-day X report total (cents) entered at the changeover for double shifts. NULL = not captured. Enables AM/PM split: AM = mid_x - open_x, PM = z_report - mid_x + rollover.';
