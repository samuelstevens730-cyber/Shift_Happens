-- 71_transaction_counts.sql
--
-- Adds open/close transaction count columns to daily_sales_records.
--
-- WHY NO DEFAULT:
--   Omitting DEFAULT means Postgres stores NULL for every existing row.
--   This is the primary contamination guard -- the application also normalises
--   0 to null at read time as defense in depth.
--
-- Idempotency notes:
--   ADD COLUMN IF NOT EXISTS skips silently when the column already exists,
--   which also skips the inline CONSTRAINT clause. The separate ALTER TABLE
--   blocks below ensure constraints are present even when the column pre-exists.

-- Step 1: add columns (no-op if they already exist)
ALTER TABLE public.daily_sales_records
  ADD COLUMN IF NOT EXISTS open_transaction_count  INTEGER NULL,
  ADD COLUMN IF NOT EXISTS close_transaction_count INTEGER NULL;

-- Step 2: add check constraints idempotently
--   DROP ... IF EXISTS then CREATE ensures the constraint is always present
--   with the correct definition regardless of prior migration state.
--
--   PREFLIGHT (run before applying this migration if the columns may already
--   exist with data — the ADD CONSTRAINT will fail if any rows violate it):
--
--     SELECT COUNT(*) FROM public.daily_sales_records WHERE open_transaction_count  < 0;
--     SELECT COUNT(*) FROM public.daily_sales_records WHERE close_transaction_count < 0;
--
--   Both queries must return 0 before proceeding.
ALTER TABLE public.daily_sales_records
  DROP CONSTRAINT IF EXISTS chk_open_txn_count_nn;
ALTER TABLE public.daily_sales_records
  ADD CONSTRAINT chk_open_txn_count_nn CHECK (open_transaction_count >= 0);

ALTER TABLE public.daily_sales_records
  DROP CONSTRAINT IF EXISTS chk_close_txn_count_nn;
ALTER TABLE public.daily_sales_records
  ADD CONSTRAINT chk_close_txn_count_nn CHECK (close_transaction_count >= 0);

-- Step 3: column comments (single string literals to avoid fragile concatenation)
COMMENT ON COLUMN public.daily_sales_records.open_transaction_count IS
  'Number of transactions rung by the opener. NULL = not captured. 0 treated as NULL by the app layer.';

COMMENT ON COLUMN public.daily_sales_records.close_transaction_count IS
  'Number of transactions rung by the closer. NULL = not captured. 0 treated as NULL by the app layer. For double shifts the app sums open + close counts.';
