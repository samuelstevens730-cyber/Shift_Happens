# Admin Redesign — Design Spec
**Date:** 2026-03-24
**Status:** Approved

---

## Overview

Redesign the admin backend to match the design language established on employee-facing pages, and restructure the `/admin` hub into a full operational Command Center. Navigation moves from a tile grid to a persistent sidebar (desktop) + bottom nav (mobile), mirroring the employee shell pattern.

Two goals tackled together in one sprint:
1. **Visual consistency** — admin pages carry the same dark atmospheric theme as employee pages
2. **Operational efficiency** — `/admin` becomes the live Command Center; navigation is always accessible

---

## Decisions Locked In

| Decision | Choice |
|---|---|
| Navigation pattern | Sidebar (desktop) + bottom nav (mobile) — mirrors employee shell |
| `/admin` hub | Full Command Center (merges `/admin/dashboard`, nothing lost) |
| Sidebar grouping | 5 groups: Live Ops · Scheduling · Payroll & Finance · Reports · People & Config |
| Design intensity | Toned-down data treatment + full employee background style |
| Typography | Barlow Condensed for page headers (consistent with employee pages) |

---

## Section 1 — Admin Shell

### New Files
- `src/app/admin/layout.tsx` — Admin route group layout
- `src/components/AdminSidebar.tsx` — Desktop sidebar nav component
- `src/components/AdminBottomNav.tsx` — Mobile bottom nav component

### `admin/layout.tsx` Responsibilities
- **Auth check** at layout level: validates Supabase manager session, redirects to `/login?next=/admin` if not authenticated. This replaces the per-page inline auth redirects (those can be removed from individual pages once the layout is in place).
- **Background**: same CSS as employee shell — `--bg0` base color, radial gradient overlays via pseudo-elements, noise texture at 0.025 opacity. Uses the existing `app-shell` class or equivalent.
- **Layout structure**: `flex` row on desktop (sidebar + content area), stacked on mobile with bottom nav fixed at bottom.
- Renders `<AdminSidebar />` on `lg+` screens, `<AdminBottomNav />` on mobile.
- Does **not** impose a max-width on content — each page controls its own.

### `AdminSidebar.tsx`
- Always visible on `lg+` screens
- Grouped nav with section labels, uses `usePathname()` for active state
- Active link: green accent (`var(--green)`), left border highlight, subtle green background tint
- Badge counts on: Requests (pending count), Variances (unreviewed count)
- Badge data fetched once on mount, not polling

**5-group structure:**
```
⚡ Home                          → /admin

── LIVE OPS ──
  Requests      [pending badge]  → /admin/requests
  Variances     [unreviewed badge] → /admin/variances
  Open Shifts                   → /admin/open-shifts
  Overrides                     → /admin/overrides
  Coverage Shifts               → /admin/coverage-shifts

── SCHEDULING ──
  Scheduler                     → /admin/scheduler
  Shifts                        → /admin/shifts
  Employee Schedules            → /admin/employee-schedules
  Assignments                   → /admin/assignments

── PAYROLL & FINANCE ──
  Payroll                       → /admin/payroll
  Reconciliation                → /admin/payroll/reconciliation
  Safe Ledger                   → /admin/safe-ledger
  Shift Sales                   → /admin/shift-sales

── REPORTS ──
  Store Sales                   → /admin/reports/store-sales
  Performance                   → /admin/reports/performance-summary
  Scoreboard                    → /admin/employee-scoreboard
  Cleaning Report               → /admin/cleaning/report

── PEOPLE & CONFIG ──
  Employees                     → /admin/users
  Reviews                       → /admin/reviews
  Cleaning Tasks                → /admin/cleaning
  Settings                      → /admin/settings
```

### `AdminBottomNav.tsx`
- Fixed at bottom on mobile, `z-50`
- 5 tabs: Home · Requests (badged) · Schedule · Payroll · More
- "More" opens a slide-up sheet containing the full sidebar nav structure
- Active state: green accent, same as employee `EmployeeBottomNav` pattern
- Mirrors the structure and CSS of `src/components/EmployeeBottomNav.tsx`

---

## Section 2 — `/admin` Hub (Command Center)

### Route Change
- `src/app/admin/page.tsx` — becomes the full Command Center (currently just a tile grid)
- `src/app/admin/dashboard/page.tsx` — converted to a redirect: `redirect('/admin')`
- The old `/admin/dashboard` URL does not 404

### Full Content Inventory (everything from current `/admin/dashboard` preserved)

**1. Page header**
- Title: "Command Center" in Barlow Condensed (same as employee page headers)
- Subtitle: current CST date + store context label
- Filter bar (collapsible, collapsed by default): start date, end date, store selector (All / LV1 / LV2)

**2. KPI row — 4 cards**
- Yesterday's Sales: total value (green accent) + sub-line: Cash · Card · X-Report Carry
- Yesterday's Closeout: status (PASS/WARN/FAIL/N/A) + variance amount
- Open Shifts: count of currently started and not ended shifts (amber accent)
- Pending Approvals: sum of swaps + time-off + timesheet corrections (amber accent)
- Card style: `bg-[var(--card)] border border-white/8 rounded-xl` — no glow borders; accent color on value only

**3. Main body — 2/3 + 1/3 grid (unchanged structure)**

*Left column (2/3):*
- **Sales Block**: tabbed Table/Chart view, date+store scoped
  - Table: Date, Store, Day, Cash, Card, X-Report Carry, Total, Status — with totals row
  - Chart: Area (total) + per-store or cash/card lines; Total/Detailed mode toggle
- **Quick Send**: Message or Task to Store or Employee — type, target type, store/employee selector, textarea, Send button (violet)

*Right column (1/3):*
- **Store Health**: per-store grade (A–D), weighted score, top drag signals with mini progress bars; grade tone colors preserved (emerald/sky/amber/red)
- **Immediate Action Items**: filterable by People / Money / Scheduling / Approvals; each item shows title, severity badge, category label, description; "Mark Reviewed" inline action for unscheduled shifts; direct action links ("Open Shift Detail", "Review Closeout", "Approve / Deny"); clicking item opens quick-view Dialog

**4. Quick-view Dialog** — preserved as-is from current dashboard

### Logic Preserved Verbatim
All of the following moves from `dashboard/page.tsx` to `admin/page.tsx` unchanged:
- `cstDateKey()`, `dateDaysAgo()`, `money()`, `shortMoney()`, `buildYAxisTicks()`, `weekdayLabel()`, `gradeTone()`
- `topline`, `visibleStores`, `actionRows`, `filteredActionRows`, `salesRows`, `tableTotals`, `chartData`, `chartYAxis` — all `useMemo` computations
- `sendQuickAssignment()`, `markUnscheduledReviewed()`, `actionDestination()`, `actionButtonLabel()`
- All `useEffect` hooks (data fetch, user fetch, resize listener)
- Full QuickView Dialog

---

## Section 3 — Page Conversion Rules

Applied uniformly to all 22 admin pages after the shell is in place.

### What the Layout Provides Automatically
Every page under `/admin` gets for free:
- Background (radial gradients, noise texture, `--bg0`)
- Sidebar nav (desktop) + bottom nav (mobile)
- Auth check + redirect

### Changes Per Page

**Remove:**
- `<Link href="/admin">Back to Admin Hub</Link>` nav links (sidebar replaces these)
- Per-page inline auth redirect logic once layout-level auth is confirmed working (remove cautiously, page by page)

**Visual updates:**
- Page title: Barlow Condensed, same weight/size as employee page headers (`font-[family-name:var(--font-barlow)] text-2xl font-bold uppercase tracking-tight` or equivalent — match whatever class is used on employee pages)
- `Card` border: replace default shadcn card border with `border-white/8` and `bg-[var(--card)]`
- Accent colors on values only: green (`var(--green)`) for positive/sales, purple (`var(--purple)`) for counts/neutral, amber/orange for pending/warning, red (`var(--danger)`) for errors — no glow box-shadows on data cards
- Buttons: existing `.btn-primary`, `.btn-secondary`, `.btn-danger` classes carry over unchanged
- Inputs, selects, textareas: existing `.input`, `.select`, `.textarea` classes unchanged
- Tables: existing border/bg patterns carry over; update any hardcoded `border-slate-800` to `border-white/8` for consistency

**Keep unchanged:**
- All data fetching and API calls
- All state management
- All business logic
- All component structure and layout
- All existing route paths
- Max-width constraints (each page controls its own)

---

## Section 4 — Implementation Sequence

Six phases, one sprint.

### Phase 1 — Admin Shell
**Files:** `src/app/admin/layout.tsx`, `src/components/AdminSidebar.tsx`, `src/components/AdminBottomNav.tsx`

Highest-leverage phase — every admin page instantly gets the background, sidebar, and bottom nav the moment this lands.

### Phase 2 — `/admin` Hub
**Files:** `src/app/admin/page.tsx` (full Command Center rewrite), `src/app/admin/dashboard/page.tsx` (→ redirect)

Full Command Center merged into `/admin`. All dashboard logic, data, and UI blocks carried over. Visual treatment updated per Section 3 rules.

### Phase 3 — Live Ops Pages
**Pages:** Requests, Variances, Open Shifts, Overrides, Coverage Shifts (5 pages)

### Phase 4 — Scheduling + Payroll & Finance
**Pages:** Scheduler, Shifts, Employee Schedules, Assignments, Payroll, Reconciliation, Safe Ledger, Shift Sales (8 pages)

### Phase 5 — Reports + People & Config
**Pages:** Store Sales, Performance Summary, Scoreboard, Cleaning Report, Employees, Reviews, Cleaning Tasks, Settings (8 pages)

### Phase 6 — Verification
- `npx tsc --noEmit` — must pass with zero errors
- `npm run build` — must pass (ignore external font fetch failures)
- Smoke test all routes: confirm nav active states, badge counts, auth redirect, mobile bottom nav, Command Center data load
- Fix any TypeScript errors introduced during conversion

---

## Design Tokens Reference

| Token | Value | Use |
|---|---|---|
| `--background` | `#0d0f12` | Page background |
| `--bg0` | `#0b0e11` | Shell base |
| `--bg1` | `#141820` | Elevated surfaces |
| `--card` | `#12151b` | Card backgrounds |
| `--cardBorder` | `rgba(173,116,255,0.35)` | Accent card borders (employee pages only — NOT used on admin data cards) |
| `--text` | `#e6e6e6` | Primary text |
| `--muted` | `#9aa3b2` | Secondary text |
| `--green` | `#20f08a` | Primary CTA, positive values, active nav |
| `--purple` | `#b470ff` | Secondary accent, counts |
| `--danger` | `#ff5c6b` | Errors, destructive actions |
| Amber/Orange | `#ffa050` | Pending/warning states |

**Typography:**
- Headers: Barlow Condensed, 700–900 weight, uppercase, tight tracking
- Body: Geist (already set globally)
- Data values: Geist, semibold/bold

---

## Invariants (Must Not Break)

- Every `/api/admin/*` route continues to call `getManagerStoreIds()` — layout-level auth does not change API-level scoping
- `/admin/dashboard` redirects to `/admin` — no 404
- `supabaseServer` never imported in client components (AdminSidebar and AdminBottomNav are client components — use `supabase` anon client for badge counts)
- All monetary values remain in cents internally; formatter functions handle display only
- CST timezone logic in dashboard (`cstDateKey`, `dateDaysAgo`) carried over verbatim
- Mobile-first: admin shell must be usable on 375px width (bottom nav, stacked layout)
