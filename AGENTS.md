# Shift Happens - Agent Guide

This document provides essential information for AI coding agents working on the Shift Happens project.

## Project Overview

**Shift Happens** is a workforce management and time tracking application built for retail environments, specifically designed for smoke shop operations. It handles time clock functionality, drawer accountability, task management, shift checklists, and payroll export.

### Key Features
- **Time Tracking**: QR-code or manual clock-in/out with planned vs actual time tracking
- **Drawer Accountability**: Start, changeover, and end drawer counts with variance detection
- **Task Management**: Assign tasks and messages to employees for their next shift
- **Shift Checklists**: Configurable per-store checklists for opening, closing, and double shifts
- **Payroll Export**: CSV export with calculated hours and drawer deltas
- **Manager Dashboard**: Variance review, override approvals, and employee management

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.1.6 | React framework with App Router |
| React | 19.2.4 | UI components |
| TypeScript | 5.9.3 | Type safety |
| Tailwind CSS | 4.x | Utility-first styling |
| Supabase | 2.x | PostgreSQL database + authentication |
| Node.js | 18+ | Runtime |

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
│   ├── auth/reset/               # Password reset page
│   ├── clock/                    # Employee clock-in flow
│   ├── login/                    # Authentication page
│   ├── run/                      # Shift redirect/resume
│   ├── shift/[id]/               # Active shift detail & checklist
│   └── sql/                      # Database migration scripts (01_schema.sql - 21_schedule_rls.sql)
│
├── components/                   # Shared React components
│   └── PinGate.tsx               # Employee PIN authentication modal
│
├── lib/                          # Shared utilities
│   ├── kioskRules.ts             # Drawer thresholds & time rounding
│   ├── clockWindows.ts           # Store-specific clock window rules
│   ├── supabaseClient.ts         # Browser Supabase client
│   ├── supabaseServer.ts         # Server Supabase client
│   ├── date.ts                   # Date formatting helpers
│   ├── alarm.ts                  # Alarm utilities
│   └── employeeSupabase.ts       # Employee auth utilities
│
└── globals.css                   # Tailwind & global styles

supabase/
├── functions/                    # Supabase Edge Functions
│   ├── employee-auth/            # PIN-based employee authentication
│   └── set-pin/                  # PIN setup for employees
└── config.toml                   # Supabase CLI configuration

tests/                            # Test files
└── clockWindows.test.ts          # Clock window logic tests

public/                           # Static assets
```

## Build and Development Commands

```bash
# Development server (uses Turbopack)
npm run dev

# Production build
npm run build

# Start production server
npm run start

# Run ESLint
npm run lint

# Run tests (Node.js native test runner with tsx)
npm run test
```

## Environment Variables

Create a `.env.local` file in the project root:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# JWT Secret (must match Supabase Functions JWT secret)
JWT_SECRET=your-jwt-secret

# Feature Flags
NEXT_PUBLIC_ENABLE_CHECKLISTS=false
```

**Security Note**: Never commit `.env.local` to version control. The service role key bypasses Row-Level Security.

## Code Style Guidelines

### File Organization
- Use **kebab-case** for file and directory names (e.g., `start-shift/route.ts`)
- Use **PascalCase** for React components (e.g., `PinGate.tsx`)
- Use **camelCase** for utility files (e.g., `kioskRules.ts`)
- Place page components in `page.tsx`, API routes in `route.ts`

### TypeScript Conventions
- Enable strict mode (configured in `tsconfig.json`)
- Use explicit return types for API route handlers
- Prefer `type` over `interface` for object shapes
- Use nullable types (`string | null`) instead of optional (`string?`) for database fields

### Component Patterns
- Use `"use client"` directive for client components (forms, interactive UI)
- Keep server components as default (no directive)
- Extract client logic to separate files when needed (e.g., `ClockPageClient.tsx`)
- Use JSDoc comments for file-level documentation

### Styling Conventions
- Use Tailwind CSS utility classes
- Custom CSS classes defined in `globals.css`:
  - `.app-shell` - Main page wrapper with gradient background
  - `.card` / `.card-pad` - Content containers
  - `.btn-primary` / `.btn-secondary` / `.btn-danger` - Buttons
  - `.input` / `.select` / `.textarea` - Form controls
  - `.banner` / `.banner-error` - Alert containers
  - `.tile` - Navigation cards
  - `.muted` - Secondary text color

### Import Order
1. React/Next.js imports
2. Third-party libraries
3. Absolute imports (`@/lib/...`, `@/components/...`)
4. Relative imports

## Testing Instructions

### Running Tests
```bash
# Run all tests
npm run test

# Run specific test file
node --test --import tsx tests/clockWindows.test.ts
```

### Test Structure
- Uses Node.js native test runner (`node:test` and `node:assert/strict`)
- Test files use `.test.ts` extension
- Tests are in `/tests` directory
- Import from `tsx` for TypeScript support

### Writing Tests
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { myFunction } from "../src/lib/myModule";

test("description of test", () => {
  assert.equal(myFunction(input), expectedOutput);
});
```

## Database Schema

### Core Tables
| Table | Purpose |
|-------|---------|
| `stores` | Physical store locations with QR tokens |
| `profiles` | Employee records |
| `store_memberships` | Employee-to-store assignments |
| `shifts` | Individual shift records |
| `shift_drawer_counts` | Drawer count events (START, CHANGEOVER, END) |
| `checklist_templates` | Checklist definitions per store/shift type |
| `checklist_items` | Individual checklist tasks |
| `shift_checklist_checks` | Completed checklist items per shift |
| `shift_assignments` | Tasks/messages assigned to employees |
| `app_users` | Admin/manager accounts |
| `store_managers` | Manager-to-store authorization |
| `schedules` / `schedule_shifts` / `schedule_assignments` | Weekly scheduling |

### Running Migrations
Execute SQL files in order in Supabase SQL Editor:
1. `01_schema.sql` - Core tables and types
2. `02_variance_review.sql` - Variance tracking
3. `03_app_users.sql` - Admin users
4. `04_store_managers.sql` - Manager roles
5. ... (continue through `21_schedule_rls.sql`)

See `src/app/sql/README.md` for complete run order.

## Security Considerations

### Authentication
- **Admin users**: Supabase Auth with email/password
- **Employees**: PIN-based authentication via Edge Function
- **PIN security**: PBKDF2 hashing with 150,000 iterations, account lockout after failed attempts

### Row-Level Security (RLS)
- RLS is enforced for admin and reporting data
- Employee clock-in flows are API-gated during MVP
- Server-side Supabase client uses service role key (bypasses RLS)
- Client-side Supabase client uses anon key (respects RLS)

### API Security
- Admin API routes should validate authentication
- Use `supabaseServer` for database operations in API routes
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client

### Environment Security
- Store sensitive keys in environment variables
- Use `NEXT_PUBLIC_` prefix only for values safe to expose to browser
- JWT secret must match between application and Supabase Functions

## Key Business Logic

### Drawer Variance Thresholds (kioskRules.ts)
- Default expected drawer: $200.00
- Alert if under by >$5 (possible theft/error)
- Alert if over by >$15 (possible unreported deposit)
- Times are rounded to 30-minute increments for payroll

### Clock Windows (clockWindows.ts)
- LV1/LV2 stores have specific clock-in windows
- Open windows: Mon-Sat 8:55-9:05 AM, Sun 11:55-12:05 PM
- Close windows vary by day (some cross midnight on Fri/Sat)
- All times in America/Chicago timezone

### Shift Types
- `open` - Opening shift (requires drawer count)
- `close` - Closing shift (requires drawer count)
- `double` - Double shift (requires changeover count)
- `other` - Miscellaneous (no drawer count required)

## Development Workflow

### Before Starting Work
1. Ensure `.env.local` is configured
2. Run `npm install` to install dependencies
3. Start dev server with `npm run dev`
4. Verify database migrations are applied

### Making Changes
1. Follow TypeScript strict mode
2. Add JSDoc comments to new files
3. Run `npm run lint` before committing
4. Test changes locally

### Deployment
- Production hosted on Vercel
- Database hosted on Supabase
- Push to GitHub triggers Vercel deployment
- Update Supabase redirect URLs for production domain

## Troubleshooting

### Common Issues
- **Build fails**: Check Node.js version (requires 18+)
- **Database connection errors**: Verify environment variables
- **Type errors**: Run `npm run lint` to check for issues
- **Test failures**: Ensure `tsx` is installed

### Debug Endpoints
- `GET /api/health` - Check environment configuration

## License

Proprietary - No Cap Smoke Shop
