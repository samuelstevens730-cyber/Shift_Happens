# Safe Ledger - Next Session Action Plan

## Current Status
- Safe Ledger Employee + Manager flows are implemented and working.
- Historical backfill support and historical badge are implemented.
- Overall store reconciliation is on the main Safe Ledger dashboard.
- Reconciliation logic now uses:
  - `Expected Total` = sum of `expected_deposit_cents` (cash - expenses)
  - `Actual Total` = sum of `denom_total_cents`
  - Variance color rules:
    - Green if within `$3`
    - Blue if `Actual > Expected`
    - Red if `Actual < Expected`

## First 15 Minutes Tomorrow
1. Run DB schema updates (if not already run):
   - `src/app/sql/49_safe_closeout_historical_backfill_flag.sql`
   - `src/app/sql/48_safe_closeout_edit_audit.sql`
2. Run historical import:
   - `src/app/sql/50_safe_ledger_historical_backfill_from_ledger_sheet1.sql`
3. Verify import counts and diffs:
   - Confirm `is_historical_backfill = true` rows exist.
   - Spot check expected/actual/denom on a few dates per store.

## Safe Ledger Follow-Up Tasks
1. Add `$2` denomination support to **live** closeout flow (currently only in backfill data):
   - SQL/RPC in `src/app/sql/47_safe_ledger_closeout.sql`
   - Employee wizard UI + validation
   - Manager exports if needed
2. Add guardrail in historical import script:
   - Abort if per-row `abs(denom_total_cents - actual_deposit_cents)` exceeds a threshold (e.g. `$5`)
3. Optional UX polish:
   - Reformat denom summary line in reconciliation cards into a compact grid for easier scan.

## Admin Dashboard Build Plan (Next Major Project)
1. Sales block (table/chart toggle, default 7 days, filterable range)
2. Immediate Action Items (expandable + scrollable), include:
   - Open shifts > 13h
   - Late/missed clock-ins
   - Swap requests
   - Time-off requests
   - Safe closeouts warn/review
   - Manual closes
3. Message / Assign Tasks composer (store or individual)
4. Open shifts by store
5. Overtime watchlist (40h/80h)
6. Store Health Grade (A/B/C/D with green/yellow/orange/red)
7. Safe/loss trend
8. Coverage gaps (keep low-priority)
9. Manager pinned notes + surface on employee home/shift ID screen

## Suggested Build Order (to stay time-efficient)
1. Dashboard shell + cards layout
2. Immediate Action Items + Open Shifts + Overtime
3. Sales block
4. Store Health Grade
5. Notes/broadcast pinned to employee views
6. Optional trend/coverage refinements

## Quick Smoke Test Checklist
- `npx tsc --noEmit`
- Open Safe Ledger dashboard:
  - Filters work
  - Reconciliation cards render per store
  - Detail modal scrolls correctly
  - Historical badge appears on imported rows
  - TSV exports still copy correctly

## Notes
- Keep scope tight on individual admin pages while building central dashboard hub.
- Prioritize high-signal, first-5-minutes-at-work insights over deep drilldowns.
