# Sales Performance Analyzer — Build Spec

## Overview

Build a sales performance analysis system that runs over existing shift/sales data and produces structured summary payloads per employee per period. The goal is to extract signal from raw data automatically so that period-over-period trends, benchmark gaps, and performance patterns can be identified without manual analysis.

This system sits on top of existing data infrastructure and reuses the adjusted sales logic already implemented in the scoreboard.

---

## Context & Constraints

- BEFORE YOU BEGIN: Check the sales normalization logic in employee-scoreboard.ts and 
- Adjusted sales normalization logic already exists. **Do not rewrite it.** Extract it into a shared module (`salesNormalization.ts`) and have both the scoreboard and this analyzer import from it.
- The scoreboard's `route.ts` is the source of truth for how adjusted sales are calculated. The analyzer must produce numbers that match the scoreboard exactly for the same date range. If they diverge, something is wrong.
- All monetary values stored as cents (integers) internally. Convert to dollars only at output layer.
- All existing auth patterns, manager store scoping, and query conventions should be followed as implemented elsewhere in the codebase.

---

## Phase 1 — Extract Shared Normalization Logic

### Task
Extract the adjusted sales calculation from the scoreboard route into a standalone shared module.

### File
`lib/salesNormalization.ts` (or equivalent path matching project conventions)

### Exports required
```typescript
// Given store totals for a period, compute per-store scaling factors
computeScalingFactors(storeTotals: StoreTotals[]): ScalingFactorMap

// Apply scaling factor to a raw sales value for a given store
applyScalingFactor(rawSalesCents: number, storeId: string, factors: ScalingFactorMap): number
```

### Validation
After extraction, confirm scoreboard output is unchanged for same date range. Numbers must match before proceeding.

---

## Phase 2 — Analyzer Module

### File
`lib/salesAnalyzer.ts`

### Input
```typescript
interface AnalyzerInput {
  employeeId: string
  storeId: string | 'all'
  from: Date
  to: Date
  managerStoreIds: string[]  // scope enforcement
}
```

### Per-Shift Computation
For each shift in range (excluding removed/invalid):
```typescript
interface ShiftSummary {
  shiftId: string
  date: string           // YYYY-MM-DD
  dayOfWeek: string      // 'Monday' etc
  storeId: string
  storeName: string
  shiftType: 'open' | 'close' | 'double' | 'other'
  startedAt: Date
  endedAt: Date
  shiftHours: number
  rawSalesCents: number
  adjustedSalesCents: number
  rawPerHour: number
  adjustedPerHour: number
  performanceFlag: 'HIGH' | 'LOW' | 'NORMAL'  // ±20% vs employee avg for period
  isCountable: boolean   // matches existing scoreboard countable logic
}
```

### Employee Summary Computation
```typescript
interface EmployeePeriodSummary {
  employeeId: string
  employeeName: string
  primaryStore: string          // store where majority of shifts worked
  period: { from: string, to: string }

  // core metrics
  totalShifts: number
  countableShifts: number
  totalHours: number
  totalRawSalesCents: number
  totalAdjustedSalesCents: number
  avgRawPerShift: number
  avgAdjustedPerShift: number
  avgRawPerHour: number
  avgAdjustedPerHour: number

  // variance flags
  highFlagCount: number
  lowFlagCount: number
  normalFlagCount: number
  highFlagPct: number           // % of shifts flagged HIGH
  lowFlagPct: number            // % of shifts flagged LOW

  // streak
  currentStreak: number         // positive = consecutive HIGHs, negative = consecutive LOWs

  // breakdowns
  byShiftType: ShiftTypeBreakdown[]
  byDayOfWeek: DayOfWeekBreakdown[]
  byStore: StoreBreakdown[]

  // benchmark
  benchmarkAdjAvg: number | null        // passed in externally
  gapVsBenchmark: number | null         // adj avg minus benchmark
  estimatedMonthlyGapCents: number | null  // gap × projected monthly shifts

  shifts: ShiftSummary[]
}

interface ShiftTypeBreakdown {
  type: string
  shifts: number
  avgAdjusted: number
  avgAdjPerHour: number
  highCount: number
  lowCount: number
}

interface DayOfWeekBreakdown {
  day: string
  shifts: number
  avgAdjusted: number
  avgAdjPerHour: number
}

interface StoreBreakdown {
  storeId: string
  storeName: string
  shifts: number
  avgAdjusted: number
}
```

### Benchmark Calculation
The benchmark is computed as the average adjusted avg across a defined set of benchmark employees (e.g. managers). Pass benchmark employee IDs as a parameter rather than hardcoding. The analyzer computes their average and uses it for gap calculations.

```typescript
interface AnalyzerOptions {
  benchmarkEmployeeIds?: string[]   // if provided, compute benchmark from these employees
  projectedMonthlyShifts?: number   // for gap extrapolation, default to shifts/period * (30 / period_days)
}
```

---

## Phase 3 — Period Snapshot Storage

### Purpose
Store a lightweight snapshot of each employee's summary after each analysis run so period-over-period deltas can be computed.

### Schema
```sql
CREATE TABLE performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  store_id UUID,                    -- NULL = all stores
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  period_label TEXT,                -- e.g. "February Biweekly 1", "Q1 2026"
  report_type TEXT NOT NULL DEFAULT 'biweekly',  -- biweekly | monthly | quarterly | custom
  snapshot JSONB NOT NULL,          -- full EmployeePeriodSummary
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),

  UNIQUE(employee_id, store_id, period_from, period_to)
);

CREATE INDEX ON performance_snapshots(employee_id, period_from DESC);
CREATE INDEX ON performance_snapshots(report_type, period_from DESC);
```

### Note
Do not overwrite existing snapshots for the same period. If a snapshot already exists for the same employee + period + store, return the existing one or expose an explicit `force` flag to overwrite.

---

## Phase 4 — Period Delta Module

### File
`lib/salesDelta.ts`

### Purpose
Compare two `EmployeePeriodSummary` objects (current vs previous) and return a delta.

### Output
```typescript
interface PeriodDelta {
  employeeId: string
  currentPeriod: string
  previousPeriod: string

  adjAvgDelta: number           // current - previous (dollars)
  adjAvgDeltaPct: number        // % change
  gapVsBenchmarkDelta: number   // is the gap closing or widening?

  highFlagDelta: number         // change in HIGH flag count
  lowFlagDelta: number          // change in LOW flag count

  trending: 'UP' | 'DOWN' | 'FLAT'   // based on adjAvgDelta threshold (suggest ±$25)

  shiftTypeChanges: {           // flag if any shift type moved significantly (±20%)
    type: string
    previousAvg: number
    currentAvg: number
    delta: number
  }[]

  notableChanges: string[]      // human-readable list of significant changes, e.g.:
                                // "Sunday opens improved $142 vs last period"
                                // "LOW flag rate increased from 20% to 50%"
                                // "Adjusted average down $74, now $373 below benchmark"
}
```

---

## Phase 5 — API Endpoint

### Endpoint
`GET /api/admin/reports/performance-summary`

### Default date range
When `from` and `to` are omitted, default to the last 14 days. The UI date picker should pre-populate this range but allow full adjustment.

### Query params
```
from=YYYY-MM-DD          (default: 14 days ago)
to=YYYY-MM-DD            (default: today)
storeId=all|uuid         (default: all)
employeeId=uuid          (optional, omit for all employees)
includeDelta=true|false  (default: false, requires previous period snapshot)
saveSnapshot=true|false  (default: false)
periodLabel=string       (optional — human label for snapshot, e.g. "February Biweekly 1", "Q1 2026")
reportType=biweekly|monthly|quarterly|custom  (default: biweekly, stored with snapshot)
```

### Response
```typescript
{
  period: { from, to, label?: string, reportType: string },
  benchmark: number,
  employees: EmployeePeriodSummary[],
  deltas?: PeriodDelta[]          // only if includeDelta=true
}
```

### Auth
Standard admin auth. Filter all queries by `managerStoreIds`.

### Errors
Return explicit `{ error: string, code: string }` for:
- Missing/invalid date params
- No shifts found for range
- Store not in manager scope

---

## Quarterly Reports

Quarterly reports are not a separate code path — they use the same analyzer, endpoint, and formatter with a wider date range. The distinction is in how snapshots are labeled and retrieved.

### What changes for quarterly:
- `reportType=quarterly` stored with snapshot
- `periodLabel` should follow format: `"Q1 2026"`, `"Q2 2026"` etc.
- Delta comparison for quarterly should compare against the **previous quarterly snapshot**, not the most recent biweekly. When `includeDelta=true` and `reportType=quarterly`, the delta module should look for the most recent prior snapshot where `report_type = 'quarterly'`.
- The text formatter should expand output for quarterly — include all shift type and day-of-week breakdowns in full rather than just best/worst.

### Suggested quarterly cadence:
- Q1: Jan 1 – Mar 31
- Q2: Apr 1 – Jun 30
- Q3: Jul 1 – Sep 30
- Q4: Oct 1 – Dec 31

### UI note:
Add a "Report Type" selector to the admin reports UI:
- Biweekly (default, 14-day picker)
- Monthly (calendar month picker)
- Quarterly (Q selector: Q1/Q2/Q3/Q4 + year)
- Custom (free date range)

Selecting a preset type auto-populates the date range. Label field auto-suggests based on type and dates (e.g. selecting Q1 2026 suggests label "Q1 2026") but remains editable.

---

## Phase 6 — Text Report Formatter

### File
`lib/performanceReportFormatter.ts`

### Purpose
Convert the structured summary payload into a compact plain-text report suitable for direct human review or for pasting into an AI for deeper analysis.

### Output format (per employee)
```
[EMPLOYEE NAME] — [PERIOD]
Store: [primary store] | Shifts: [n] | Hours: [n]
Adj Avg: $[x] | Raw Avg: $[x] | Adj/Hr: $[x]
Benchmark gap: $[x]/shift | Est. monthly gap: $[x]
Trend vs last period: [UP/DOWN/FLAT] $[delta] ([pct]%)
Flags: [n] HIGH ([pct]%) | [n] LOW ([pct]%) | Streak: [n]

Best shift type: [type] @ $[avg] adj avg
Worst shift type: [type] @ $[avg] adj avg
Best day: [day] @ $[avg] | Worst day: [day] @ $[avg]

Notable changes vs last period:
- [change 1]
- [change 2]
```

### Endpoint
`GET /api/admin/reports/performance-summary?format=text`

Add `format=text` param to the existing endpoint. When present, return `Content-Type: text/plain` with the formatted report instead of JSON.

---

## Phase 7 — Validation

1. Run analyzer for the same date range as an existing scoreboard view. Confirm adjusted averages match scoreboard exactly for every employee. If any diverge by more than $0.02, log the discrepancy and throw.

2. Confirm benchmark gap calculations are correct against manual spot-check.

3. Confirm period delta direction matches what a human observer would conclude from the raw numbers.

4. Confirm manager store scope is enforced — a manager should not be able to retrieve data for stores outside their scope.

5. Confirm `saveSnapshot` persists correctly and `includeDelta` correctly retrieves the most recent prior snapshot.

---

## Phase 8 — Hardening

- Row cap or streaming for large date ranges (> 90 days or > 500 shifts)
- Log all report generations: who, when, range, store scope, whether snapshot was saved
- Return `warnings[]` array in response for data quality issues (e.g. shifts with $0 sales over 6+ hours, missing closeout data)
- Graceful handling when no prior snapshot exists for delta (return `delta: null` with explanation)

---

## Summary of Files

| File | Purpose |
|------|---------|
| `lib/salesNormalization.ts` | Shared scaling factor logic (extracted from scoreboard) |
| `lib/salesAnalyzer.ts` | Core per-employee summary computation |
| `lib/salesDelta.ts` | Period-over-period comparison |
| `lib/performanceReportFormatter.ts` | Plain-text report output |
| `api/admin/reports/performance-summary/route.ts` | API endpoint |
| Migration | `performance_snapshots` table |

---

## Important Notes for Claude Code

- Read the existing scoreboard `route.ts` before writing anything. The adjusted sales logic must be extracted exactly as-is, not reimplemented.
- Follow all existing code conventions, naming patterns, and query structure in the codebase.
- Do not modify the scoreboard route's behavior. Extraction only.
- The `performanceFlag` (HIGH/LOW/NORMAL) is computed against the employee's own average for the period, not the benchmark. ±20% threshold.
- Monetary values are cents (integers) in the database. All division and averaging should happen in cents and convert to dollars at the formatter layer only.
- Build and validate Phase 1 before proceeding to Phase 2. Each phase depends on the previous being confirmed correct.

---

## Monthly Reports

Monthly reports are a synthesis layer — they combine two biweekly snapshots AND run a full raw data pass for the month, then reconcile the two. This gives you both the period-by-period arc and a ground-truth check against the raw numbers.

### When to run
Second sales meeting of the month, after both biweekly reports have been saved as snapshots.

### What it does differently

**Step 1 — Locate biweekly snapshots**
Query `performance_snapshots` for the two most recent biweekly snapshots where `report_type = 'biweekly'` and `period_from >= first day of month` and `period_to <= last day of month`. If fewer than two biweekly snapshots exist for the month, warn but proceed with whatever is available plus the raw pass.

**Step 2 — Raw data pass**
Run the full analyzer over the entire month date range as a single window (same logic as any other report). This is the ground truth.

**Step 3 — Reconcile**
For each employee, compare:
- Combined biweekly avg (average of biweekly 1 adj avg and biweekly 2 adj avg, weighted by shift count)
- Raw month adj avg

If they diverge by more than $5, flag as a data quality warning in the report. This surfaces manual entry issues, missing shifts, or anything that slipped through between periods.

**Step 4 — Synthesize**
Produce the monthly summary with all three layers present.

---

### Monthly-specific output structure

```typescript
interface MonthlyReportEmployee {
  employeeId: string
  employeeName: string

  // Biweekly breakdown
  biweekly1: EmployeePeriodSummary | null    // first half snapshot
  biweekly2: EmployeePeriodSummary | null    // second half snapshot

  // Raw month pass
  rawMonthSummary: EmployeePeriodSummary

  // Synthesis
  monthly: {
    totalShifts: number
    totalHours: number
    avgAdjustedPerShift: number             // weighted avg across full month
    avgRawPerShift: number
    avgAdjPerHour: number

    halfOverHalfDelta: number               // biweekly2 adj avg minus biweekly1 adj avg
    halfOverHalfTrend: 'IMPROVING' | 'DECLINING' | 'FLAT' | 'INSUFFICIENT_DATA'

    benchmarkGap: number
    estimatedMonthlyGapCents: number        // based on actual shift count this month

    highFlagCount: number
    lowFlagCount: number
    currentStreak: number

    bestShiftType: string
    worstShiftType: string
    bestDayOfWeek: string
    worstDayOfWeek: string
  }

  // Reconciliation
  reconciliation: {
    combinedBiweeklyAdj: number             // weighted avg of both biweeklies
    rawMonthAdj: number                     // from raw pass
    delta: number                           // difference
    flagged: boolean                        // true if delta > $5
    note: string | null                     // human-readable explanation if flagged
  }
}

interface MonthlyReport {
  month: string                             // e.g. "February 2026"
  reportType: 'monthly'
  period: { from: string, to: string }
  benchmark: number
  biweeklySnapshots: { label: string, from: string, to: string }[]
  employees: MonthlyReportEmployee[]
  dataQualityWarnings: string[]             // any reconciliation flags across all employees
}
```

---

### Monthly endpoint

Extend the existing endpoint with `reportType=monthly`. When monthly is detected:
- Require `from` and `to` to span a full calendar month, or derive from a `month=YYYY-MM` param
- Auto-locate biweekly snapshots for that month
- Run raw pass
- Reconcile and synthesize
- Return `MonthlyReport` shape instead of standard response

```
GET /api/admin/reports/performance-summary?reportType=monthly&month=2026-02
```

Or with explicit dates:
```
GET /api/admin/reports/performance-summary?reportType=monthly&from=2026-02-01&to=2026-02-28
```

---

### Monthly text formatter output

Extend `performanceReportFormatter.ts` to handle `MonthlyReport`. Output per employee:

```
[EMPLOYEE NAME] — February 2026 (Monthly)
Store: [primary] | Shifts: [n] | Hours: [n]

FIRST HALF ([label]):  Adj Avg $[x] | [n] HIGH / [n] LOW
SECOND HALF ([label]): Adj Avg $[x] | [n] HIGH / [n] LOW
Half-over-half: [IMPROVING/DECLINING/FLAT] $[delta]

FULL MONTH: Adj Avg $[x] | Raw Avg $[x] | Adj/Hr $[x]
Benchmark gap: $[x]/shift | Monthly gap: $[x]

Best shift type: [type] @ $[x] | Worst: [type] @ $[x]
Best day: [day] @ $[x]        | Worst: [day] @ $[x]

Reconciliation: [CLEAN / FLAG: $x delta — note]
```

---

### UI additions for monthly

Add `Monthly` to the Report Type selector. When selected:
- Show a month picker (month + year) instead of a date range picker
- Auto-populate `from`/`to` from selected month
- Auto-suggest label: `"February 2026"`
- Show a notice if fewer than 2 biweekly snapshots are found for the selected month: "Only 1 biweekly snapshot found for this month. Monthly report will use raw data only for the first-half comparison."

---

### Delta behavior for monthly

When `includeDelta=true` with a monthly report, compare against the previous monthly snapshot (`report_type = 'monthly'`, most recent prior). This gives you month-over-month trend rather than biweekly-over-biweekly.

---

### Summary of report type comparison

| Type | Window | Delta compares against | Primary use |
|------|--------|----------------------|-------------|
| Biweekly | ~14 days (adjustable) | Previous biweekly | Regular sales meetings |
| Monthly | Calendar month | Previous monthly | Second meeting of month, full synthesis |
| Quarterly | ~90 days | Previous quarterly | Quarterly review, big picture |
| Custom | Any range | Most recent same type | Ad hoc analysis |
