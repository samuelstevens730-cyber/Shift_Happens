# Shift Happens

Workforce operations platform for retail teams (clock-in/out, payroll, variance control, reporting, and coaching dashboards).

## What It Does

- Clock-in/out with planned vs actual time tracking
- Drawer controls: start, changeover, end counts with manager review workflows
- Daily sales + rollover handling for late-night operations
- Payroll reporting and exports
- Employee and manager scoreboards with category-level breakdowns
- Store-level and employee-level performance reports (with PDF export)
- Scheduling, requests, assignments, checklist, and cleaning workflows
- Weather capture + report context

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript (strict)
- Tailwind CSS v4
- Supabase (Postgres, Auth, Storage, RLS)
- Vercel deployment

## Authentication Model

- Managers: Supabase auth (email/password + Bearer token)
- Employees: PIN-based auth issuing JWT; employee API calls use `Authorization: Bearer <token>`

## Setup

### Prerequisites

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
```

### Run

```bash
npm run dev
```

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

### API (`src/app/api`)

- Admin APIs: `admin/*`
  - `dashboard`, `payroll`, `safe-ledger`, `reports/*`, `employee-scoreboard`, `shift-sales`, `settings`, `users`, `variances`, `schedules`, `employee-schedules`, `requests`, and more
- Employee/clock APIs:
  - `start-shift`, `end-shift`, `confirm-changeover`, `checklist/*`, `cleaning/*`, `sales/*`, `messages/*`, `requests/*`, `shift/*`, `employee/*`

### UI (`src/app`)

- Manager surfaces:
  - `admin/dashboard`
  - `admin/payroll`
  - `admin/reports/store-sales`
  - `admin/reports/performance-summary`
  - `admin/employee-scoreboard`
  - scheduling, users, variances, safe ledger, requests, etc.
- Employee surfaces:
  - `clock`
  - `shift/[id]`
  - `scoreboard`
  - `scoreboard/shifts`

## Reporting Highlights

- Store Sales report:
  - rollover-aware sales attribution
  - transactions, basket size, labor efficiency metrics
  - period-over-period top-line deltas
  - PDF export
- Performance Summary report:
  - employee-level adjusted/raw performance
  - shift/day breakdowns, score context
  - period-over-period top-line deltas
  - PDF export

## Operational Rules (Important)

- Timezone logic uses explicit America/Chicago handling (not client local time assumptions)
- Payroll/reporting uses planned start + end behavior by policy
- Double-shift attendance and scoring are handled as a single worked double unit
- Drawer/changeover accuracy rules are enforced in scoreboard + breakdown flows

## Cron / Scheduled Jobs

Scheduled endpoints under `src/app/api/cron/*` are protected by `CRON_SECRET`.

## Notes

- This project is actively evolving; use `AGENTS.md` as the authoritative engineering contract for auth, RLS, migration policy, and route patterns.

