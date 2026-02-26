-- 70_performance_snapshots.sql
--
-- Creates the performance_snapshots table used by the Sales Performance Analyzer.
-- Stores one snapshot (EmployeePeriodSummary JSON) per employee per period per store.
--
-- UNIQUE constraint uses partial indexes because PostgreSQL treats NULL != NULL,
-- so a standard UNIQUE(col, nullable_col, ...) would silently allow duplicate rows
-- when store_id IS NULL (all-stores snapshots). Partial indexes avoid this.
--
-- Idempotent: safe to re-run (uses IF NOT EXISTS + DROP POLICY IF EXISTS).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.performance_snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID        NOT NULL REFERENCES public.profiles(id),
  store_id      UUID        NULL REFERENCES public.stores(id),  -- NULL = all stores aggregated; FK still enforced when non-null
  period_from   DATE        NOT NULL,
  period_to     DATE        NOT NULL,
  period_label  TEXT        NULL,                               -- e.g. "February Biweekly 1", "Q1 2026"
  report_type   TEXT        NOT NULL DEFAULT 'biweekly',
  snapshot      JSONB       NOT NULL,                          -- full EmployeePeriodSummary
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID        NULL REFERENCES auth.users(id),

  -- Data integrity checks
  CONSTRAINT performance_snapshots_period_order
    CHECK (period_from <= period_to),
  CONSTRAINT performance_snapshots_report_type
    CHECK (report_type IN ('biweekly', 'monthly', 'quarterly', 'custom'))
);

-- ---------------------------------------------------------------------------
-- Unique indexes (partial, to handle nullable store_id correctly)
-- ---------------------------------------------------------------------------

-- All-stores snapshots (store_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS performance_snapshots_unique_all_stores
  ON public.performance_snapshots (employee_id, period_from, period_to)
  WHERE store_id IS NULL;

-- Per-store snapshots (store_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS performance_snapshots_unique_per_store
  ON public.performance_snapshots (employee_id, store_id, period_from, period_to)
  WHERE store_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Supporting indexes
-- ---------------------------------------------------------------------------

-- Primary lookup: most recent snapshots per employee
CREATE INDEX IF NOT EXISTS performance_snapshots_employee_period
  ON public.performance_snapshots (employee_id, period_from DESC);

-- Lookup by report type (biweekly / monthly / quarterly)
CREATE INDEX IF NOT EXISTS performance_snapshots_report_type_period
  ON public.performance_snapshots (report_type, period_from DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.performance_snapshots ENABLE ROW LEVEL SECURITY;

-- SELECT: manager may read snapshots for stores they manage.
-- For all-store snapshots (store_id IS NULL), any manager may read.
-- For per-store snapshots, manager must manage that store.
DROP POLICY IF EXISTS "performance_snapshots_manager_select" ON public.performance_snapshots;
CREATE POLICY "performance_snapshots_manager_select"
  ON public.performance_snapshots
  FOR SELECT
  TO authenticated
  USING (
    (
      store_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.store_managers sm
        WHERE sm.user_id = auth.uid()
      )
    )
    OR
    (
      store_id IS NOT NULL
      AND store_id IN (
        SELECT sm.store_id
        FROM public.store_managers sm
        WHERE sm.user_id = auth.uid()
      )
    )
  );

-- INSERT: created_by must be the current user AND user must manage the relevant store.
DROP POLICY IF EXISTS "performance_snapshots_manager_insert" ON public.performance_snapshots;
CREATE POLICY "performance_snapshots_manager_insert"
  ON public.performance_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      (
        store_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.store_managers sm
          WHERE sm.user_id = auth.uid()
        )
      )
      OR
      (
        store_id IS NOT NULL
        AND store_id IN (
          SELECT sm.store_id
          FROM public.store_managers sm
          WHERE sm.user_id = auth.uid()
        )
      )
    )
  );

-- No UPDATE policy: snapshots are immutable.
-- To re-run a period, delete the row manually and re-save.
-- No DELETE policy: prevent accidental data loss via API.
