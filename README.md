# Shift Happens

A workforce management and time tracking application built for retail environments, specifically designed for smoke shop operations with drawer accountability and shift management features.

## Project Overview

Shift Happens is a comprehensive time clock and shift management system that handles:

- **Time Tracking**: QR-code or manual clock-in/out with planned vs actual time tracking
- **Drawer Accountability**: Start, changeover, and end drawer counts with variance detection and manager alerts
- **Task Management**: Assign tasks and messages to employees for their next shift
- **Shift Checklists**: Configurable per-store checklists for opening, closing, and double shifts
- **Payroll Export**: CSV export with calculated hours and drawer deltas for payroll processing
- **Manager Dashboard**: Variance review, override approvals, and employee management

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **Next.js 16** | React framework with App Router |
| **React 19** | UI components |
| **TypeScript** | Type safety |
| **Tailwind CSS** | Utility-first styling |
| **Supabase** | PostgreSQL database + authentication + Row-Level Security | *RLS is enforced for admin and reporting data. Employee clock-in flows are intentionally API-gated during MVP to minimize friction.* 
| **Vercel** | Hosting and deployment |

## Setup Instructions

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account

### 1. Clone the Repository

```bash
git clone <repository-url>
cd sad-zhukovsky
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Where to find these values:**
- Go to your Supabase project dashboard
- Navigate to Settings → API
- Copy the Project URL and anon/public key for the `NEXT_PUBLIC_` variables
- Copy the service_role key for `SUPABASE_SERVICE_ROLE_KEY` (keep this secret!)

### 4. Database Setup

Run the SQL migration files in order in your Supabase SQL Editor:

```
src/app/sql/01_schema.sql        # Core tables and types
src/app/sql/02_variance_review.sql
src/app/sql/03_app_users.sql
src/app/sql/04_store_managers.sql
src/app/sql/05_payroll_rpc.sql
src/app/sql/06_seed_managers.sql
src/app/sql/07_shift_assignments.sql
src/app/sql/08_checklists_per_store.sql
src/app/sql/09_missing_counts.sql
src/app/sql/10_shift_rules.sql
src/app/sql/11_rls.sql           # Row-level security policies
src/app/sql/12_assignments_soft_delete.sql
src/app/sql/13_shift_audit.sql
```

### 5. Configure Supabase Authentication

1. Go to Supabase Dashboard → Authentication → URL Configuration
2. Set your Site URL: `http://localhost:3000` (dev) or your production URL
3. Add Redirect URLs:
   - `http://localhost:3000/**`
   - `https://your-domain.vercel.app/**`
   - `https://your-domain.vercel.app/auth/reset`

### 6. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── api/                      # Backend API routes
│   │   ├── admin/                # Admin-only endpoints
│   │   │   ├── assignments/      # Task/message CRUD
│   │   │   ├── missing-counts/   # Missing drawer count reports
│   │   │   ├── open-shifts/      # Stale shift management
│   │   │   ├── overrides/        # Long shift approvals
│   │   │   ├── payroll/          # Payroll data export
│   │   │   ├── settings/         # Store configuration
│   │   │   ├── shifts/           # Shift CRUD
│   │   │   ├── users/            # Employee management
│   │   │   └── variances/        # Drawer variance review
│   │   ├── checklist/            # Checklist item completion
│   │   ├── shift/                # Shift detail & assignment actions
│   │   ├── start-shift/          # Clock-in endpoint
│   │   ├── end-shift/            # Clock-out endpoint
│   │   └── confirm-changeover/   # Double shift drawer count
│   │
│   ├── admin/                    # Admin dashboard pages
│   │   ├── assignments/          # Task management UI
│   │   ├── open-shifts/          # Monitor active shifts
│   │   ├── overrides/            # Approve long shifts
│   │   ├── payroll/              # Export payroll data
│   │   ├── settings/             # Store & checklist config
│   │   ├── shifts/               # View/edit all shifts
│   │   ├── users/                # Employee profiles
│   │   └── variances/            # Review drawer variances
│   │
│   ├── auth/reset/               # Password reset page
│   ├── clock/                    # Employee clock-in flow
│   ├── login/                    # Authentication page
│   ├── run/                      # Shift redirect/resume
│   ├── shift/[id]/               # Active shift detail & checklist
│   └── sql/                      # Database migration scripts
│
├── lib/                          # Shared utilities
│   ├── kioskRules.ts             # Drawer thresholds & time rounding
│   ├── supabaseClient.ts         # Browser Supabase client
│   ├── supabaseServer.ts         # Server Supabase client
│   └── date.ts                   # Date formatting helpers
│
└── globals.css                   # Tailwind & global styles
```

## Key Features

### Employee Clock In/Out Workflow

1. Employee scans store QR code or selects store manually
2. Selects their name from the employee list (temporary for MVP only)
3. Chooses shift type (open, close, double, other)
4. Enters planned start time (rounded to 30-minute increments)
5. Enters starting drawer count (except for "other" shifts)
6. If drawer is out of threshold, confirms and optionally notifies manager
7. Accesses shift detail page with checklist and assignments

### Drawer Variance Tracking

- **Expected drawer**: Configurable per store (default $200)
- **Thresholds**: Alerts if drawer is >$5 under or >$15 over expected
- **Count types**: START (clock-in), CHANGEOVER (double shifts), END (clock-out)
- **Manager notification**: Optional flag when employee confirms out-of-threshold count
- **Review workflow**: Managers can review and acknowledge variances

### Shift Checklists

- Templates configured per store and shift type
- Items grouped by category (e.g., "Opening Tasks", "Closing Tasks")
- Required vs optional items
- Completion tracked per shift
- Automatically populated from template at shift start

### Manager Dashboard

| Module | Purpose |
|--------|---------|
| **Shifts** | View, filter, edit, delete all shifts |
| **Open Shifts** | Monitor and force-close stale shifts |
| **Variances** | Review out-of-threshold drawer counts |
| **Overrides** | Approve shifts exceeding 13 hours |
| **Payroll** | View completed shifts, export CSV |
| **Users** | Manage employee profiles and store assignments |
| **Assignments** | Create tasks/messages for employees |
| **Settings** | Configure stores and checklists |

### Task/Message Assignment

- **Tasks**: Actionable items employees must complete
- **Messages**: Informational notices employees acknowledge
- Target individual employees or all employees at a store
- Delivered when employee starts their next shift
- Tracked with acknowledgment and completion timestamps

## Database Tables

| Table | Purpose |
|-------|---------|
| `stores` | Physical store locations with QR tokens and drawer expectations |
| `profiles` | Employee records (can link to auth users) |
| `store_memberships` | Which employees can clock in at which stores |
| `shifts` | Individual shift records with times and override status |
| `shift_drawer_counts` | Drawer count events (START, CHANGEOVER, END) with variance flags |
| `checklist_templates` | Reusable checklist definitions per store/shift type |
| `checklist_items` | Individual items within a template |
| `shift_checklist_checks` | Tracks completed checklist items per shift |
| `shift_assignments` | Tasks and messages assigned to employees |
| `app_users` | Admin/manager accounts (linked to Supabase auth) |
| `store_managers` | Links managers to their authorized stores |

## Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import the repository in Vercel
3. Add environment variables in Vercel project settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy

### Production Checklist

- [ ] Update Supabase Site URL to production domain
- [ ] Add production domain to Supabase Redirect URLs
- [ ] Verify Row-Level Security policies are enabled
- [ ] Test password reset flow with production URLs (⚠️ Password resets are handled by the application. Supabase-generated reset emails must include /auth/reset as an allowed redirect URL or users will be redirected to the home page without a token.)
- [ ] Generate QR codes for each store's clock-in URL

## Future Roadmap  

- [ ] **PIN Authentication**: Employee PIN codes for faster clock-in
- [ ] **Employee Portal**: Self-service schedule viewing and time-off requests
- [ ] **Schedule Management**: Create and publish employee schedules
- [ ] **SOP Library**: Standard operating procedures accessible during shifts
- [ ] **Mobile App**: Native iOS/Android apps for employees
- [ ] **Real-time Notifications**: Push notifications for task assignments
- [ ] **Analytics Dashboard**: Shift patterns, labor costs, variance trends

## License

Proprietary - No Cap Smoke Shop

---

Built with ❤️ for retail workforce management
