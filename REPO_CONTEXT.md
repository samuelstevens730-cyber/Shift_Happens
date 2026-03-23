# REPO_CONTEXT.md

System map for engineers and AI agents. Based entirely on code and existing docs.
Last updated: 2026-03-04.

---

## System Overview

Workforce management application for two retail stores (**LV1**, **LV2**).

**What it does:**
- Employees clock in/out via PIN-authenticated kiosk (mobile-first)
- Managers schedule, monitor, approve, and export from desktop/tablet
- Tracks shift time, drawer counts, daily sales, safe closeouts, and payroll

**Environment:**
- Stack: Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS v4, Supabase PostgreSQL
- Hosted on **Vercel Hobby tier** — 10-second API route timeout hard limit
- Timezone: All business logic uses **America/Chicago (CST)** via `Intl` API — never moment/luxon
- Monetary values are always in **cents (integers)** inside the stack; dollars appear only in formatters

---

## Core Domain Model

| Table | Purpose |
|---|---|
| `shifts` | Clock-in/out records. Columns: `shift_type` (open/close/double/other), `planned_start_at`, `started_at`, `ended_at`, `last_action`, weather snapshots, `manual_close`, `is_unscheduled` |
| `shift_drawer_counts` | Drawer count records per shift. `count_type`: start / changeover / end. Includes `drawer_cents`, variance flags, `notified_manager`, manager review fields |
| `shift_assignments` | Tasks and messages assigned to employees. `type`: task / message. Lifecycle: `delivered_at` → `acknowledged_at` → `completed_at` |
| `shift_checklist_checks` | Which checklist items were completed for a given shift |
| `shift_sales_counts` | Per-shift x/z/rollover report entries (raw inputs from employees) |
| `daily_sales_records` | Per-store, per-date sales aggregation. **Primary source for all performance reporting.** Key columns: `open_x_report_cents`, `close_sales_cents`, `z_report_cents`, `rollover_from_previous_cents`, `closer_rollover_cents`, `opener_rollover_cents`, `is_rollover_night`, `open_transaction_count`, `close_transaction_count` |
| `safe_closeouts` | Accounting-only closeout records. Z-report aligned (does NOT include rollover carry). Columns: `cash_sales_cents`, `card_sales_cents`, `variance_cents`, denomination JSONB, status (draft/pass/warn/fail/locked), photo links |
| `google_reviews` | Per-employee Google review submissions. Status lifecycle: draft → pending → approved/rejected. Includes screenshot storage path, submitter metadata, review metadata, and manager review fields |
| `schedules` | Pay-period schedule containers (draft/published/archived) |
| `schedule_shifts` | Individual planned shifts within a schedule |
| `shift_templates` | Weekly shift patterns per store and day-of-week |
| `shift_swap_requests` + `shift_swap_offers` | Employee shift-swap workflow |
| `time_off_requests` + `time_off_blocks` | Time-off request workflow. Approved requests insert `time_off_blocks`, which the scheduler uses to warn/block same-day assignments |
| `timesheet_change_requests` | Timesheet correction requests |
| `advance_requests` | Pay advance requests |
| `profiles` | Employee records: `pin_hash`, `pin_fingerprint`, `employee_code`, `name`, `avatar_url`, `active`, `auth_user_id` |
| `app_users` | Manager records — `app_users.id` is the linked `auth.users.id` |
| `store_managers` | Manager-to-store assignment (scoping table for all admin auth) |
| `store_memberships` | Employee-to-store assignment |
| `stores` | Store records: `name`, `qr_token`, `expected_drawer_cents`, `latitude`, `longitude` |
| `store_settings` | Per-store feature flags: `sales_tracking_enabled`, `sales_rollover_enabled`, `safe_ledger_enabled`, `pin_auth_enabled`, `scheduling_enabled` |
| `store_rollover_config` | Per-store, per-`day_of_week` rollover flags (`has_rollover`) |
| `clock_windows` | Clock-in/out allowed time windows per store, shift type, and day-of-week (CST) |
| `checklist_templates` + `checklist_items` | Per-store open/close checklist definitions |
| `store_cleaning_schedules` + `cleaning_task_completions` | Cleaning matrix: required tasks per shift type, completion tracking |
| `audit_logs` + `shift_change_audit_logs` | Full audit trail for manager and system actions |

---

## System Architecture

### Employee-Facing Pages

| Route | Purpose |
|---|---|
| `/` | Home — bento-grid hub (schedule, hours, messages, requests, admin link) |
| `/clock` | Clock-in entry — QR token preselection, store select, PIN entry |
| `/shift/[id]` | **Active shift hub** — drawer counts, checklists, tasks, messages, safe closeout wizard, rollover entry |
| `/shift/[id]/done` | Post-clock-out confirmation summary |
| `/schedule` | Personal schedule view (pay period) |
| `/shifts` | Timecard — all past shifts with hours |
| `/dashboard/requests` | Swap, time-off, advance requests |
| `/dashboard/scoreboard` | Employee performance ranking |
| `/reviews` | Google Reviews tracker with monthly leaderboard and screenshot submission |

### Admin Pages

| Route | Purpose |
|---|---|
| `/admin` | Command hub — 23 tile navigation grid |
| `/admin/dashboard` | Command Center — live ops KPIs, sales, health score, priority actions |
| `/admin/payroll` | Payroll export (finished shifts) |
| `/admin/payroll/reconciliation` | Payment and advance reconciliation |
| `/admin/variances` | Drawer variance review queue (badge count on hub) |
| `/admin/open-shifts` | Monitor stale/abandoned shifts |
| `/admin/shifts` | Shift CRUD with filtering |
| `/admin/overrides` | Approve shifts >13 hours |
| `/admin/requests` | Swap/time-off/timesheet approval queue |
| `/admin/safe-ledger` | Safe closeout audit, evidence review, export |
| `/admin/shift-sales` | Per-shift AM/PM sales, rollover entries |
| `/admin/employee-scoreboard` | Weighted employee ranking (manager view) |
| `/admin/reports/performance-summary` | Employee performance report (period analysis, benchmarks) |
| `/admin/reports/store-sales` | Store executive report (cross-store sales, RPLH, weather) |
| `/admin/reviews` | Reviews approval queue, full history table, CSV export, and manager direct submit |
| `/admin/users` | Employee profile/store assignment management plus employee-code visibility/editing |
| `/admin/cleaning` | Cleaning task library editor plus store/day/shift requirement matrix |
| `/admin/cleaning/report` | Day-by-day cleaning audit of completed and skipped tasks by store |
| `/admin/assignments` | Assign tasks and messages for next shift |
| `/admin/settings` | Store config, checklists, feature flags |
| `/admin/scheduler` | Schedule builder and publishing. Approved time off is surfaced from `time_off_blocks` as day notes, filtered pick-lists, and save-time conflict prevention |
| `/admin/employee-schedules` | View schedules per employee |

---

## Backend Architecture

### API Route Organization

```
src/app/api/
├── start-shift/          POST  Clock in
├── end-shift/            POST  Clock out
├── confirm-changeover/   POST  Mid-shift changeover (doubles)
├── sales/
│   ├── context/          GET   Sales context for shift (rollover status, prior X)
│   ├── close-checkpoint/ POST  10 PM Z-report submission on rollover nights
│   └── rollover/         POST  Blind rollover entry (closer + opener)
├── shift/[id]/           GET   Shift detail
│   ├── start-drawer/     POST  Opening drawer count
│   └── assignments/[id]/ GET/PATCH/DELETE  Assignment management
├── closeout/             POST  Safe closeout draft, submit, upload URL
├── checklist/check-item/ POST  Mark checklist item complete
├── cleaning/[shiftId]/   GET   Cleaning tasks; /complete and /skip actions
├── me/profile/           GET   Authenticated profile
├── me/avatar/            GET/PATCH  Avatar management
├── requests/             Swap, time-off, timesheet request CRUD + lifecycle
├── employee/scoreboard/  GET   Employee scorecard
├── reviews/              GET   Reviews scoreboard + my submissions (dual auth)
├── reviews/upload-url/   POST  Create draft + signed upload URL
├── reviews/finalize/     POST  Finalize draft to pending with month/ownership checks
├── cron/purge-draft-reviews/ POST  Purge stale review drafts (CRON_SECRET)
└── admin/
    ├── dashboard/        GET   KPIs, open shifts, action items, sales history
    ├── shifts/           GET/POST/PATCH/DELETE  Shift management
    ├── open-shifts/      GET   Unended shifts; /[id]/end force-end
    ├── assignments/      GET/POST  Task/message management
    ├── schedules/        GET/POST  Schedule management + publish
    ├── payroll/          GET   Payroll report + reconciliation
    ├── safe-ledger/      GET/POST/PATCH  Safe closeout management
    ├── variances/        GET   Variance review queue; /[id]/review
    ├── overrides/        GET   Long shifts; /[id]/approve
    ├── users/            GET/POST/PATCH  Employee management
    ├── cleaning/         GET/POST  Cleaning matrix; /tasks for task CRUD; /report for audit data
    ├── settings/         GET/PATCH  Store config
    ├── reports/
    │   ├── performance-summary/  GET  Employee performance report
    │   └── store-sales/          GET  Store executive report
    ├── reviews/          GET  Reviews list + filters
    ├── reviews/[id]/     PATCH/DELETE  Approve/reject/delete review
    ├── reviews/export/   GET  Reviews CSV export
    └── backfill-weather/ POST  Retroactive weather fill
```

### Service Role Pattern

All API routes use `supabaseServer` (service role — bypasses RLS). **Security is enforced in application code**, not database policies:

- **Admin routes:** Must call `getManagerStoreIds(user.id)` → scope all queries by returned store IDs
- **Employee routes:** Must call `authenticateShiftRequest(req)` → resolve `AuthContext` → validate store and profile access
- Inline `store_managers` queries are **forbidden** — always use `getManagerStoreIds()`

### Supabase Clients

| Client | File | Scope |
|---|---|---|
| `supabaseServer` | `src/lib/supabaseServer.ts` | Service role — server-side API routes only |
| `supabase` | `src/lib/supabaseClient.ts` | Anon key — browser/client components |
| `createEmployeeSupabase(token)` | `src/lib/employeeSupabase.ts` | Custom JWT header — used when RLS policies need to read JWT claims |

---

## Authentication Model

### Manager Auth

```
1. Email + password → Supabase Auth → auth.users
2. API route extracts Bearer token from Authorization header
3. supabaseServer.auth.getUser(token) → user
4. getManagerStoreIds(user.id) → store ID array
5. All queries filtered by those store IDs
```

- Helper: `getBearerToken(req)` in `src/lib/adminAuth.ts`
- Helper: `getManagerStoreIds(userId)` in `src/lib/adminAuth.ts`

### Employee Auth

```
1. Employee selects store, enters PIN
2. POST to Supabase Edge Function employee-auth
3. Edge Function verifies PIN hash → issues ES256 JWT
4. JWT claims: { profile_id, store_ids, store_id, role: "employee" }
5. JWT stored in sessionStorage
6. All employee API calls send Bearer <JWT>
7. API routes call authenticateShiftRequest(req) to resolve AuthContext
```

- JWT verification: `verifyEmployeeJWT(token)` in `src/lib/jwtVerify.ts`
- Dual auth resolver: `authenticateShiftRequest(req)` in `src/lib/shiftAuth.ts`
- JWT claims are **not DB-verified on every request** (known limitation — see AGENTS.md)

### Dual Auth (`shiftAuth.ts`)

`authenticateShiftRequest` tries employee JWT first, falls back to manager Supabase auth. Returns a unified `AuthContext`:

```typescript
type AuthContext = {
  authType: "employee" | "manager";
  profileId: string;
  storeIds: string[];
  authUserId?: string;
}
```

`validateStoreAccess(auth, storeId)` — verifies store membership.
`validateProfileAccess(auth, requestedProfileId)` — no cross-profile access allowed.

---

## Key Operational Flows

### Clock-In (`/api/start-shift`)

1. Employee selects store and enters PIN → JWT issued by Edge Function
2. `POST /api/start-shift` with `profileId`, `storeId`, `plannedStartAt`, `startDrawerCents`
3. Auth validated via `authenticateShiftRequest`
4. Clock window validated via `clockWindows.ts` + `clock_windows` table (CST)
5. Matching `schedule_shifts` record found (if scheduled) or flagged as unscheduled
6. Shift type defaults from the scheduled row for that date (double if open+close coverage), with user override allowed at clock-in and during active shift
7. `shifts` row inserted; `shift_drawer_counts` start record written
8. Start time rounded to 30-minute boundary for payroll
9. `fetchCurrentWeather()` called (fire-and-forget) — updates `start_weather_condition`, `start_temp_f` on shift

### Active Shift (`/shift/[id]`)

The shift hub page manages:
- **Drawer counts** — START (on clock-in), CHANGEOVER (doubles only), END (on clock-out)
  - Variance > $5 under or > $15 over triggers manager notification flag + alarm
- **Checklist** — required items gate clock-out; optional items tracked but non-blocking
- **Tasks and messages** — all assignments must be acknowledged/completed before clock-out
- **Cleaning tasks** — complete or skip with reason
- **Safe closeout wizard** — available to close/double shifts when safe ledger is enabled
- **Rollover entry** — shown post-clock-out on rollover nights for closer amount entry

### Rollover Night Flow (LV2 Fri/Sat)

```
10:00 PM  Closer runs Z report → POST /api/sales/close-checkpoint
           Writes: close_sales_cents, z_report_cents, is_rollover_night = true
           (transaction count NOT captured here)

12:00 AM  Closer clocks out → POST /api/end-shift
           Writes: is_rollover_night = true, close_transaction_count (full 5PM–midnight)

After out  Closer submits post-10PM sales → POST /api/sales/rollover (source = "closer")
           Writes: closer_rollover_cents

Next AM    Opener submits their version → POST /api/sales/rollover (source = "opener")
           Writes: opener_rollover_cents
           RPC submit_rollover_entry() reconciles:
             → If match: sets rollover_cents, seeds next day's rollover_from_previous_cents
             → If mismatch: flags for manager review
```

### Shift Closeout (Safe Ledger)

1. `checkSafeCloseoutWindow(shiftId)` validates time window (opens 30 min before scheduled end; hard cap 10 PM on rollover nights)
2. Employee submits denomination breakdown, cash/card totals, photos
3. `POST /api/closeout/save-draft` — persists draft
4. `POST /api/closeout/submit` — status → pass/warn/fail based on variance
5. Manager reviews via `/admin/safe-ledger` — can approve, note, or reject

### Clock-Out (`/api/end-shift`)

1. Auth validated
2. Pending required checklist items, unacknowledged messages, incomplete tasks checked — blocked if any open
3. Drawer counts validated (start + end required; changeover required for doubles)
4. Variance thresholds checked; override flag required if >13 hours
5. Sales data written to `daily_sales_records` (if sales tracking enabled)
6. `ended_at` set on shift
7. `fetchCurrentWeather()` called (fire-and-forget) — updates `end_weather_condition`, `end_temp_f`

---

## Reporting System

### Employee Performance Report

**Route:** `GET /api/admin/reports/performance-summary`
**Page:** `/admin/reports/performance-summary`
**Computation:** `src/lib/salesAnalyzer.ts` — pure function, no DB calls

Measures per employee across a date range:
- Adjusted average sales per shift (normalized across stores)
- Transaction count, basket size (avg sales per transaction)
- Performance flags: HIGH (>120% of personal avg), LOW (<80%), NORMAL
- Consecutive streak of HIGH or LOW flags
- Benchmark gap (vs designated benchmark employee)
- Period-over-period delta via `salesDelta.ts`
- Shift-type and day-of-week breakdowns
- AM/PM split for doubles (requires `mid_x_report_cents`)

**Sales formula (shift-level):**
```
Open:   open_x_report_cents - rollover_from_previous_cents
Close:  close_sales_cents + closer_rollover_cents (if is_rollover_night)
Double: (open net) + (close net + rollover carry)
```

### Store Executive Report

**Route:** `GET /api/admin/reports/store-sales`
**Page:** `/admin/reports/store-sales`
**Computation:** `src/lib/storeReportAnalyzer.ts` — pure function, no DB calls

Measures per store across a date range:
- Gross sales (calendar-day, rollover-adjusted), adjusted gross (normalized)
- Transactions, basket size, labor hours, RPLH
- Daily trend with rolling 7-day averages
- Day-of-week averages, shift-type breakdown
- Cash/card split and deposit variance (from `safe_closeouts` — accounting view only)
- Weather summary, outlier flags, weather-impact hint
- Volatility (std dev, coefficient of variation, sigma outliers)
- Top performers by volume and efficiency
- Period-over-period deltas (previous equivalent period auto-fetched)
- Data integrity: missing sales days, missing transaction days, rollover-adjusted days

**Calendar-day gross formula:**
```
gross = (open_x_report_cents - rollover_from_previous_cents)  ← AM net
      + close_sales_cents                                       ← PM net
      + closer_rollover_cents  (when is_rollover_night = true) ← post-10 PM
```

**Source distinction:**
- Performance reporting (both reports) → `daily_sales_records` with rollover math
- Accounting/safe ledger → `safe_closeouts` (Z-report aligned, no rollover adjustment)

### Report Output Formats

Both reports support:
- **Web UI** — styled cards and tables in the browser
- **Plain-text export** — copy-paste for manual LLM prompting (no automated API calls)
- **PDF download** — `@react-pdf/renderer` blob pattern (follows `GridSchedulePDF.tsx`)

---

## Critical Business Logic Locations

| Module | Path | What It Enforces |
|---|---|---|
| `salesAnalyzer.ts` | `src/lib/salesAnalyzer.ts` | Employee performance computation — sales formula, normalization, flags, streaks, benchmark |
| `storeReportAnalyzer.ts` | `src/lib/storeReportAnalyzer.ts` | Store report computation — calendar-day gross, weather analysis, volatility, top performers |
| `salesNormalization.ts` | `src/lib/salesNormalization.ts` | Store scaling factor = network avg / store avg per shift |
| `salesDelta.ts` | `src/lib/salesDelta.ts` | Period-over-period delta, trending direction, notable changes |
| `shiftAuth.ts` | `src/lib/shiftAuth.ts` | Dual auth resolution (employee JWT + manager); `AuthContext` type; store/profile access validation |
| `adminAuth.ts` | `src/lib/adminAuth.ts` | Manager Bearer token extraction; `getManagerStoreIds()` — the mandatory store-scoping function |
| `clockWindows.ts` | `src/lib/clockWindows.ts` | CST time-window rules for clock-in/out (LV1/LV2, by day-of-week) |
| `kioskRules.ts` | `src/lib/kioskRules.ts` | Drawer variance thresholds ($5 under / $15 over); payroll time rounding to 30-min boundaries |
| `safeCloseoutWindow.ts` | `src/lib/safeCloseoutWindow.ts` | Safe closeout window validation (30 min before end; 10 PM hard cap on rollover nights) |
| `salesNormalization.ts` | `src/lib/salesNormalization.ts` | Store scaling factors for cross-store comparison |
| `weatherClient.ts` | `src/lib/weatherClient.ts` | OWM API calls — never throws, never blocks clock-in/out, 5-second timeout |
| `performanceReportFormatter.ts` | `src/lib/performanceReportFormatter.ts` | Employee report plain-text output; **only place** where cents → dollars conversion happens for employee reports |
| `storeReportFormatter.ts` | `src/lib/storeReportFormatter.ts` | Store report plain-text output; cents → dollars for store reports |
| `jwtVerify.ts` | `src/lib/jwtVerify.ts` | ES256 JWT signature verification for employee tokens |

---

## Directory Map

```
src/
├── app/
│   ├── (employee)/         Employee-scoped layout group
│   │   ├── avatar/         Avatar setup page
│   │   └── scoreboard/     Employee ranking view
│   ├── admin/              All manager-facing pages
│   │   ├── dashboard/      Command Center (KPIs, actions)
│   │   ├── payroll/        Payroll + reconciliation
│   │   ├── reports/
│   │   │   ├── performance-summary/  Employee performance report
│   │   │   └── store-sales/          Store executive report
│   │   ├── safe-ledger/    Safe closeout audit
│   │   ├── scheduler/      Schedule builder
│   │   ├── settings/       Store config, checklists, feature flags
│   │   ├── shifts/         Shift CRUD
│   │   ├── variances/      Drawer variance review
│   │   └── ...             (other admin pages)
│   ├── api/                All API routes (see Backend Architecture)
│   │   ├── admin/          Manager-only routes
│   │   ├── cron/           Cron job endpoints (expire-requests, send-nudges)
│   │   ├── sales/          Sales tracking endpoints
│   │   ├── shift/[id]/     Shift-specific operations
│   │   ├── start-shift/    Clock-in
│   │   ├── end-shift/      Clock-out
│   │   └── requests/       Employee request CRUD + lifecycle
│   ├── sql/                74 ordered SQL migration files (00–74)
│   ├── auth/               Auth callback pages
│   ├── clock/              Clock-in page
│   ├── login/              Manager login
│   ├── shift/[id]/         Active shift hub + done confirmation
│   ├── shifts/             Timecard page
│   └── schedule/           Personal schedule view
├── components/
│   ├── pdf/                PDF components (GridSchedulePDF, StoreReportPDF, etc.)
│   └── ui/                 Shared UI components
└── lib/
    ├── adminAuth.ts        Manager auth helpers
    ├── alarm.ts            Web Audio siren
    ├── clockWindows.ts     Clock-in/out time validation
    ├── date.ts             HTML input date formatting
    ├── employeeColors.ts   Consistent employee color assignment
    ├── employeeSupabase.ts JWT-authorized Supabase client factory
    ├── jwtVerify.ts        Employee JWT verification
    ├── kioskRules.ts       Drawer thresholds + payroll rounding
    ├── performanceReportFormatter.ts  Employee report text output
    ├── safeCloseoutWindow.ts  Closeout time window validation
    ├── salesAnalyzer.ts    Employee performance computation
    ├── salesDelta.ts       Period-over-period delta
    ├── salesNormalization.ts  Store sales scaling
    ├── shiftAuth.ts        Dual auth resolver
    ├── storeReportAnalyzer.ts  Store report computation
    ├── storeReportFormatter.ts  Store report text output
    ├── supabaseClient.ts   Browser Supabase (anon key)
    ├── supabaseServer.ts   Server Supabase (service role)
    ├── utils.ts            Tailwind class merge (cn)
    └── weatherClient.ts    OpenWeatherMap integration
```

---

## System Invariants

These rules must never be broken.

### Auth & Store Isolation
- Every admin API route **must** call `getManagerStoreIds()` and filter all queries by the result
- No inline `store_managers` table queries — use `adminAuth.ts` helpers only
- No cross-store data access — managers only see their assigned stores
- Employee routes must use `authenticateShiftRequest()` — no bare JWT parsing in route files

### Timezone
- All time comparisons and clock-window checks use **America/Chicago (CST)** via `Intl`
- `new Date()` or `.toISOString()` without timezone conversion must not be used for business-date decisions
- Pay period and business date boundaries are CST midnight, not UTC midnight
- Review month cutoff: `review_date` must be within the current CST calendar month (server-enforced on `/api/reviews/finalize`), with no grace period

### Sales Formulas
- **Performance reporting** always uses `daily_sales_records` with rollover math (AM + PM + carry-out)
- **Accounting/safe ledger** always uses `safe_closeouts` (Z-report aligned, no rollover)
- These two sources must never be swapped between contexts
- `closer_rollover_cents` belongs to the day it was earned (the rollover night), not the next calendar day

### Rollover Integrity
- `closer_rollover_cents` = post-10 PM sales on rollover night (written via `/api/sales/rollover`)
- `rollover_from_previous_cents` = carry-in seeded automatically by `submit_rollover_entry` RPC
- Opener and closer submit independently (blind dual-entry) — one must not read the other's value
- Mismatch flags must be reviewed by a manager before the record is trusted for reporting

### Drawer and Payroll
- Drawer thresholds: under $5 → `notified_manager` required; over $15 → `notified_manager` required
- Payroll rounding applied consistently via `roundTo30Minutes()` in `kioskRules.ts`
- Shifts >13 hours require manager override before appearing in payroll

### Monetary Values
- All monetary values stored and computed in **cents (integers)**
- Dollars appear **only** in formatter output layer (`performanceReportFormatter.ts`, `storeReportFormatter.ts`, UI display components)
- Never divide or compare raw cents as floats — always integer arithmetic

### Weather Capture
- `fetchCurrentWeather()` must never throw and must never delay or fail clock-in/out
- Always wrapped in try/catch; failure silently skips the update

### Service Role Security
- `supabaseServer` bypasses all RLS — application-level filtering is the only guard
- Never import `supabaseServer` in client-side components
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — never exposed via `NEXT_PUBLIC_` prefix

---

## Known Technical Debt

From `AGENTS.md`:

| Area | Issue |
|---|---|
| Service role usage | All admin and employee routes use service role with app-level scoping. Has not been audited for gaps. |
| Timezone logic | Historical off-by-one bugs in CST date boundary calculations. New code should use `cstDateKey()` helper pattern from `storeReportAnalyzer.ts`. |
| Employee JWT claims | Claims are verified on signature but **not re-checked against DB** on every request. A deactivated employee with a valid JWT can still make requests until the JWT expires. |
| Reference tables | `clock_windows`, `cleaning_tasks`, and similar config tables have no RLS by design — any authenticated client can read them. |
| Clock-in store listing | `/api/start-shift` and the clock page allow unauthenticated access to list stores and profiles for the PIN entry flow. Flagged for future tightening. |
| Vercel timeout | 10-second API timeout on Hobby tier. Routes that do multiple sequential DB calls (e.g., `/api/end-shift`) are close to this limit and could fail under load. |

---

## Relationship to AGENTS.md

`AGENTS.md` is an **engineering contract** — it specifies rules that must be followed when writing or modifying code (auth patterns, forbidden patterns, required helpers, RLS requirements, high-risk file callouts).

`REPO_CONTEXT.md` is a **system map** — it describes what the system does, how it is structured, and where the important logic lives.

**Use both together:**
- Before modifying a flow, read the relevant section of this document to understand what data is involved and which lib modules are in the path
- Before writing any code, read `AGENTS.md` to understand the rules that govern how code must be written in this repo
- If the two documents appear to conflict, `AGENTS.md` takes precedence (it defines constraints; this document describes current state)
