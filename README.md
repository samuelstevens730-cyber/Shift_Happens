# Shift Happens

A workforce management and time tracking application built for retail environments, specifically designed for smoke shop operations with drawer accountability, shift management, sales tracking, and employee performance features.

## What It Does

Shift Happens is a comprehensive time clock and shift management system that handles:

- **Time Tracking**: QR-code or manual clock-in/out with planned vs actual time tracking
- **Drawer Accountability**: Start, changeover, and end drawer counts with variance detection and manager alerts
- **Sales Tracking**: X report entry per shift, mid-shift X reports for double shifts, midnight rollover handling, and store sales reporting
- **Safe Ledger**: End-of-day safe closeout form, cash pickup logging with photo upload, and historical ledger for managers
- **Scheduling**: Visual weekly scheduler with draft and publish workflow; employees can view their upcoming schedule
- **Employee Requests**: Shift swap, time-off, and timesheet correction requests with full manager approval/denial workflow
- **Employee Scoreboard**: 7-category performance scoring with store-normalized sales comparison and public rankings
- **Task Management**: Assign tasks and messages to employees for their next shift
- **Shift Checklists**: Configurable per-store checklists for opening, closing, and double shifts
- **Cleaning Tasks**: Recurring store cleaning schedules with per-shift complete/skip tracking
- **Payroll Export**: CSV export with calculated hours, drawer deltas, and payroll advance tracking
- **Manager Dashboard**: Variance review, override approvals, unscheduled shift review, and employee management

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Next.js 16** | React framework with App Router |
| **React 19** | UI components |
| **TypeScript** | Type safety |
| **Tailwind CSS v4** | Utility-first styling |
| **Radix UI** | Accessible UI primitives (Select, Tabs, Collapsible, Separator) |
| **Recharts** | Charts for sales and performance reporting |
| **date-fns** | Date manipulation and formatting |
| **jose** | JWT signing and verification for employee auth |
| **@react-pdf/renderer** | PDF generation for payroll and reports |
| **lucide-react** | Icon library |
| **Supabase** | PostgreSQL database + authentication + Row-Level Security |
| **Vercel** | Hosting, deployment, and analytics |

> **RLS note**: Row-Level Security is enforced for admin and reporting data. Employee clock-in flows are API-gated during MVP to minimize friction. Employee-facing portal routes use JWT-based auth (via `jose`) rather than Supabase auth sessions.

## User Roles

| Role | Access |
|------|--------|
| **Employee** | Clock in/out, view shift checklist and assignments, submit sales X reports, complete cleaning tasks, submit swap/time-off/timesheet requests, view schedule and scoreboard |
| **Manager** | All employee access plus: approve/deny requests, review variances, manage overrides, view payroll, manage assignments and checklists, enter sales data, review safe ledger |
| **Admin** | Full access including store configuration, user management, checklist template editing, and all manager functions |

Managers and admins authenticate via Supabase Auth. Employees authenticate via PIN (stored in `employee_pins`) which issues a short-lived JWT.

## Authentication Model

- Managers: Supabase auth (email/password + Bearer token)
- Employees: PIN-based auth issuing JWT; employee API calls use `Authorization: Bearer <token>`

## Setup

### Prerequisites

```bash
git clone <repository-url>
cd Shift_Happens
```
- Node.js 18+
- npm
- Supabase project

### Install

```bash
npm install
```

### Environment Variables (`.env.local`)

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

CRON_SECRET=your-long-random-secret

# Weather API (optional — used to record weather at shift time)
WEATHER_API_KEY=your-openweathermap-api-key
```

### Run

```bash
npm run dev
```

Run all numbered migration files in order in your Supabase SQL Editor:

```
src/app/sql/01_schema.sql          # Core tables and types
src/app/sql/02_variance_review.sql
...
src/app/sql/74_store_location.sql  # Store lat/long for weather
```

All files are numbered sequentially. Run them in order from `01` through `74`. Note: there is no `57_*.sql` — this gap is intentional.

> **Note**: `00_consolidated.sql` exists but only contains the initial schema and is not a substitute for running all migrations.

### 5. Configure Supabase Authentication
### Validate

```bash
npx tsc --noEmit
npm run build
```

## Database / Migrations

SQL migrations live in:

- `src/app/sql/`
- `supabase/migrations/` (if present in your environment)

Apply migrations in numeric order. Do not edit already-deployed migrations; add forward migrations.

## Current App Surface

### 7. Run Tests

```bash
npm test
```

Tests use Node's built-in test runner with `tsx` for TypeScript support.

## Project Structure

```
src/
├── app/                               # Next.js App Router
│   ├── (employee)/                    # Employee portal (JWT-gated)
│   │   ├── avatar/                    # Avatar selection and upload
│   │   └── scoreboard/                # Public employee rankings
│   │       └── shifts/                # Per-shift score breakdown
│   │
│   ├── admin/                         # Manager/admin pages
│   │   ├── assignments/               # Task/message management
│   │   ├── cleaning/                  # Cleaning task admin
│   │   ├── dashboard/                 # Admin home dashboard
│   │   ├── employee-schedules/        # View schedules by employee
│   │   ├── employee-scoreboard/       # Employee performance scoring
│   │   ├── open-shifts/               # Monitor and force-close stale shifts
│   │   ├── overrides/                 # Approve long shifts (>13 hrs)
│   │   ├── payroll/                   # Payroll export
│   │   │   └── reconciliation/        # Payroll advance reconciliation
│   │   ├── reports/
│   │   │   ├── performance-summary/   # Cross-employee performance report
│   │   │   └── store-sales/           # Store sales summary report
│   │   ├── requests/                  # Shift swap / time-off / timesheet queue
│   │   ├── safe-ledger/               # Safe closeout ledger and pickup log
│   │   ├── scheduler/                 # Visual weekly schedule builder
│   │   ├── settings/                  # Store and checklist configuration
│   │   ├── shift-export/              # Shift data export
│   │   ├── shift-sales/               # Sales X report entry per shift
│   │   ├── shifts/                    # View, filter, edit, delete all shifts
│   │   │   └── [shiftId]/             # Individual shift detail/edit
│   │   ├── users/                     # Employee profiles and store assignments
│   │   └── variances/                 # Review out-of-threshold drawer counts
│   │
│   ├── api/                           # Backend API routes
│   │   ├── admin/                     # Admin-only endpoints (Supabase auth required)
│   │   │   ├── assignments/           # Task/message CRUD + bulk delete
│   │   │   ├── backfill-weather/      # Retroactively fetch weather for shifts
│   │   │   ├── cleaning/              # Cleaning task management
│   │   │   ├── dashboard/             # Dashboard aggregated data
│   │   │   ├── employee-schedules/    # Schedule view by employee
│   │   │   ├── employee-scoreboard/   # Scoreboard data + shift breakdown
│   │   │   ├── missing-counts/        # Missing drawer count reports
│   │   │   ├── open-shifts/           # Stale shift management + force-end
│   │   │   ├── overrides/             # Long shift approval
│   │   │   ├── payroll/               # Payroll data, advances, reconciliation, report
│   │   │   ├── reports/               # Performance and store sales reports
│   │   │   ├── safe-ledger/           # Closeout review, pickup management, upload URLs
│   │   │   ├── schedules/             # Schedule CRUD, publish, batch assign, totals
│   │   │   ├── settings/              # Store config and checklist templates
│   │   │   ├── shift-sales/           # Admin sales entry
│   │   │   ├── shifts/                # Shift CRUD, detail, hard delete, unscheduled review
│   │   │   ├── stores/                # Store management and location
│   │   │   ├── users/                 # Employee profile management
│   │   │   └── variances/             # Drawer variance review
│   │   │
│   │   ├── checklist/check-item/      # Mark checklist items complete
│   │   ├── cleaning/                  # Cleaning task complete/skip (JWT)
│   │   ├── closeout/                  # Safe closeout submit, draft, upload URL (JWT)
│   │   ├── confirm-changeover/        # Double shift drawer changeover
│   │   ├── cron/
│   │   │   ├── expire-requests/       # Auto-expire stale open swap requests
│   │   │   └── send-nudges/           # Remind employees of pending actions
│   │   ├── employee/scoreboard/       # Employee-facing scoreboard (JWT)
│   │   ├── end-shift/                 # Clock-out endpoint
│   │   ├── health/                    # Health check endpoint
│   │   ├── me/                        # Employee self-service profile and avatar
│   │   ├── messages/                  # In-shift messaging and dismiss
│   │   ├── requests/                  # Shift swap, time-off, timesheet request flows
│   │   ├── sales/                     # X report context, close-checkpoint, rollover
│   │   ├── shift/                     # Shift detail, assignments, start-drawer
│   │   ├── start-shift/               # Clock-in endpoint
│   │   └── time-off-blocks/           # Employee availability blocks
│   │
│   ├── auth/reset/                    # Password reset page
│   ├── clock/                         # Employee clock-in flow (PIN + store select)
│   ├── dashboard/                     # Employee self-service dashboard
│   │   ├── requests/                  # Submit and track requests
│   │   ├── schedule/                  # View published schedule
│   │   ├── scoreboard/                # Personal scoreboard view
│   │   └── shifts/                    # Personal shift history
│   ├── login/                         # Manager/admin authentication
│   ├── run/[shiftId]/                 # Active shift redirect/resume
│   ├── schedule/                      # Employee schedule view
│   ├── shift/[id]/                    # Active shift detail, checklist, and assignments
│   │   └── done/                      # Post-clock-out summary
│   └── sql/                           # Database migration scripts (01–74)
│
└── lib/                               # Shared utilities
    ├── adminAuth.ts                   # Supabase session auth for admin routes
    ├── alarm.ts                       # Drawer threshold and alert logic
    ├── clockWindows.ts                # Valid clock-in window calculation from schedule
    ├── date.ts                        # Date formatting helpers (CST-aware)
    ├── employeeColors.ts              # Consistent color assignment per employee
    ├── employeeSupabase.ts            # Supabase client scoped to employee JWT
    ├── jwtVerify.ts                   # JWT sign/verify for employee PIN auth
    ├── kioskRules.ts                  # Drawer thresholds and time rounding rules
    ├── performanceReportFormatter.ts  # Formats performance summary report data
    ├── safeCloseoutWindow.ts          # Business logic for when closeout is allowed
    ├── salesAnalyzer.ts               # Computes shift sales from X reports and rollover
    ├── salesDelta.ts                  # Incremental sales delta helpers
    ├── salesNormalization.ts          # Cross-store sales normalization for scoreboard
    ├── shiftAuth.ts                   # Auth middleware for shift-scoped routes
    ├── storeReportAnalyzer.ts         # Aggregates store-level sales and performance data
    ├── storeReportFormatter.ts        # Formats store sales report data
    ├── supabaseClient.ts              # Browser Supabase client
    ├── supabaseServer.ts              # Server Supabase client
    ├── utils.ts                       # General utility helpers
    └── weatherClient.ts               # OpenWeatherMap API integration
```

## Key Features

### Employee Clock-In/Out Workflow

1. Employee scans store QR code or selects store manually
2. Enters their PIN (issued by manager)
3. Chooses shift type: open, close, double, or other
4. Enters planned start time (rounded to 30-minute increments)
5. Enters starting drawer count (except "other" shifts)
6. If drawer is out of threshold, confirms and optionally notifies manager
7. Accesses shift detail page with checklist, cleaning tasks, and assignments

**Clock windows**: When a published schedule exists, clock-in is gated to a configurable window around the scheduled start time. A fallback is available if no schedule is published.

### Drawer Variance Tracking

- **Expected drawer**: Configurable per store (default $200)
- **Thresholds**: Alerts if drawer is >$5 under or >$15 over expected
- **Count types**: START (clock-in), CHANGEOVER (double shifts), END (clock-out)
- **Manager notification**: Optional flag when employee confirms out-of-threshold count
- **Review workflow**: Managers can review and acknowledge variances

### Sales Tracking (X Reports)

- Employees enter register X report totals at the end of close and double shifts
- Mid-shift X report captured at changeover for double shifts
- Midnight rollover handling splits sales across calendar days for overnight shifts
- Store-level toggle to enable/disable rollover tracking
- Transaction counts tracked alongside dollar amounts (migration 71)
- Admin sales entry available for corrections

### Safe Ledger & Closeout

- Employees submit end-of-day safe closeout form (denominations → total)
- Supports $2 bills (migration 53)
- Cash pickups logged with optional photo upload (Supabase Storage)
- Managers review and acknowledge closeouts via the safe ledger
- Historical backfill flag for migrating legacy data

### Employee Scheduling

- Managers build weekly schedules in a visual drag-and-drop style scheduler
- Schedules exist in draft state until explicitly published
- Published schedules are visible to employees via `/schedule` and `/dashboard/schedule`
- Schedule totals (hours per employee per week) calculated server-side
- Batch shift assignment from schedule to actual shifts

### Employee Request System

| Request Type | Flow |
|---|---|
| **Shift Swap** | Employee posts open swap → other employees offer → original employee selects → manager approves/denies |
| **Time Off** | Employee submits request with dates → manager approves/denies with optional reason |
| **Timesheet Correction** | Employee flags incorrect clock-in/out times → manager approves/denies → shift updated |

Stale open swap requests are auto-expired by a cron job every 15 minutes. Nudge notifications sent every 6 hours for pending actions.

### Employee Scoreboard

Performance is scored across 7 categories:

| Category | Description |
|---|---|
| **Raw Sales** | Total X report sales for the period |
| **Adjusted Sales** | Sales normalized across stores for fair comparison |
| **Attendance** | Scheduled shifts worked vs. missed |
| **Punctuality** | Clock-in time vs. scheduled start |
| **Drawer Accuracy** | Drawer variance frequency and severity |
| **Cash Handling** | Closeout accuracy |
| **Task Master** | Checklist and cleaning task completion rate |

Scores are computed from `performance_snapshots` and displayed publicly to employees. Admins see a detailed breakdown per employee with per-shift drill-down.

### Shift Checklists

- Templates configured per store and shift type (open, close, double, other)
- Items grouped by category (e.g., "Opening Tasks", "Closing Tasks")
- Required vs. optional items
- Completion tracked per shift in `shift_checklist_checks`
- Automatically populated from template at shift start

### Cleaning Tasks

- Store-level recurring cleaning schedules (`store_cleaning_schedules`)
- Separate from shift checklists — appear alongside checklist during active shifts
- Employees mark items complete or skip with reason
- Completions tracked in `cleaning_task_completions`
- Feeds into Task Master category on the scoreboard

### Manager Dashboard

| Module | Purpose |
|--------|---------|
| **Dashboard** | At-a-glance summary of open shifts, pending reviews, and recent activity |
| **Shifts** | View, filter, edit, delete all shifts; per-shift detail page |
| **Open Shifts** | Monitor active shifts and force-close stale ones |
| **Variances** | Review out-of-threshold drawer counts |
| **Overrides** | Approve shifts exceeding 13 hours |
| **Unscheduled Review** | Review and acknowledge shifts not on the published schedule |
| **Payroll** | View completed shifts, export CSV, track advances, reconciliation |
| **Users** | Manage employee profiles, PIN assignment, and store memberships |
| **Assignments** | Create tasks/messages for employees |
| **Settings** | Configure stores and checklist templates |
| **Scheduler** | Build and publish weekly schedules |
| **Safe Ledger** | Review closeouts and cash pickups |
| **Requests** | Approve/deny shift swaps, time-off, and timesheet corrections |
| **Scoreboard** | Admin view of employee performance scores |
| **Reports** | Store sales summary and cross-employee performance reports |
| **Shift Sales** | Enter or correct X report sales data per shift |

### Task/Message Assignment

- **Tasks**: Actionable items employees must complete during their shift
- **Messages**: Informational notices employees acknowledge
- Target individual employees or all employees at a store
- Delivered when employee starts their next shift
- Tracked with acknowledgment and completion timestamps
- Bulk delete supported

## Database Tables

| Table | Purpose |
|-------|---------|
| `stores` | Physical store locations with QR tokens, drawer expectations, and lat/long |
| `profiles` | Employee records linked to optional auth users |
| `store_memberships` | Which employees can clock in at which stores |
| `shifts` | Individual shift records with times, type, source, and override status |
| `shift_drawer_counts` | Drawer count events (START, CHANGEOVER, END) with variance flags |
| `checklist_templates` | Reusable checklist definitions per store and shift type |
| `checklist_items` | Individual items within a template |
| `shift_checklist_checks` | Tracks completed checklist items per shift |
| `shift_assignments` | Tasks and messages assigned to employees |
| `app_users` | Admin/manager accounts linked to Supabase auth |
| `store_managers` | Links managers to their authorized stores |
| `employee_pins` | Hashed PIN codes for employee clock-in authentication |
| `schedules` | Schedule week records (draft or published) |
| `schedule_shifts` | Individual scheduled slots within a schedule |
| `shift_swap_requests` | Employee-initiated swap requests with offer/select/approve flow |
| `time_off_requests` | Time-off requests with approval status and denial reason |
| `timesheet_requests` | Timesheet correction requests |
| `daily_sales_records` | X report and rollover sales data per shift/date |
| `safe_closeouts` | End-of-day safe totals with denomination breakdown and variance |
| `safe_pickups` | Mid-day cash pickups with optional photo URL |
| `store_cleaning_schedules` | Recurring cleaning task templates per store |
| `cleaning_task_completions` | Per-shift cleaning task complete/skip records |
| `payroll_advances` | Advance pay records per employee |
| `audit_logs` | General admin action audit trail |
| `shift_change_audit_logs` | Per-field edit history for shifts |
| `performance_snapshots` | Periodic scoreboard score snapshots per employee |

## Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import the repository in Vercel
3. Add environment variables in Vercel project settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `CRON_SECRET`
   - `WEATHER_API_KEY` (optional)
4. Deploy

### Scheduled Jobs (GitHub Actions)

Set these repository secrets:
- `CRON_BASE_URL` (e.g., `https://your-domain.vercel.app`)
- `CRON_SECRET` (must match `CRON_SECRET` in Vercel env)

The workflow in `.github/workflows/cron-requests.yml` calls:
- `POST /api/cron/expire-requests` every 15 minutes — expires stale open swap requests
- `POST /api/cron/send-nudges` every 6 hours — sends nudges for pending actions

### Production Checklist

- [ ] Update Supabase Site URL to production domain
- [ ] Add production domain to Supabase Redirect URLs
- [ ] Verify Row-Level Security policies are enabled (migration 11 + subsequent RLS migrations)
- [ ] Test password reset flow with production URLs
  - > Warning: Supabase-generated reset emails must include `/auth/reset` as an allowed redirect URL or users will be redirected to the home page without a token.
- [ ] Generate QR codes for each store's clock-in URL (`/clock?store=<qr_token>`)
- [ ] Issue PINs to all employees via the Users admin panel
- [ ] Set `CRON_SECRET` in both Vercel and GitHub repository secrets
- [ ] Configure store drawer expected amounts and variance thresholds in Settings

## Future Roadmap

- [ ] **Mobile App**: Native iOS/Android apps for employees
- [ ] **Real-time Notifications**: Push notifications for task assignments and request updates
- [ ] **SOP Library**: Standard operating procedures accessible during shifts
- [ ] **Biometric Clock-In**: Face ID / fingerprint support for kiosk devices

## License

Proprietary - No Cap Smoke Shop

---

Built for retail workforce management
