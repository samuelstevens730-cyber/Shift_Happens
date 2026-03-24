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

### `ClientHeader` Retirement (Phase 1)
`src/app/clientheader.tsx` currently renders **only on admin routes** (`if (!isAdminRoute) return null`). It is the existing admin top bar. Once `admin/layout.tsx` provides `AdminSidebar` and `AdminBottomNav`, `ClientHeader` is fully redundant.

**Action in Phase 1:** Remove `<ClientHeader />` from `src/app/layout.tsx`. The component itself can remain in the file for now but will effectively be dead code. This eliminates the structural collision between the old admin bar and the new shell.

### `admin/layout.tsx` Responsibilities
- **`"use client"` — Client Component.** `@supabase/ssr` is not installed; server-side cookie-based session reads are not available. The layout uses the same client-side auth pattern already used across all admin pages: calls `supabase.auth.getSession()` on mount, redirects to `/login?next=/admin` if no session. This is consistent with current behavior — API-level enforcement via `getManagerStoreIds()` remains the real security guard.
- Per-page inline auth redirect logic can be removed page by page **after Phase 1 layout auth is confirmed working** — not before.
- **Background**: same CSS as employee shell — `--bg0` base color, radial gradient overlays via pseudo-elements, noise texture at 0.025 opacity.
- **Layout structure**: `flex` row — `AdminSidebar` (fixed, 224px) + scrollable content `div` that fills remaining width. This uses a flexbox container rather than global `padding-left` hacks, so it does not interfere with the existing `.employee-desktop-sidebar` push rules in `globals.css`.
- Renders `<AdminSidebar />` on `lg+` screens (hidden on mobile via `hidden lg:flex`), `<AdminBottomNav />` on mobile (visible below `lg`).
- Does **not** impose a max-width on content — each page controls its own.
- The content area div gets `overflow-y: auto` and `flex: 1 1 0` so full-width pages (scheduler, reports) still fill correctly.

### `AdminSidebar.tsx`
- Always visible on `lg+` screens
- Grouped nav with section labels, uses `usePathname()` for active state
- Active link: green accent (`var(--green)`), left border highlight, subtle green background tint
- Badge counts on: Requests (pending count), Variances (unreviewed count)
- **Compose button:** Pinned at the bottom of the sidebar (above the user/store label). Uses `PenSquare` icon (Lucide) + "Quick Send" label, styled as `.btn-secondary` (purple outline, full width). Clicking opens the Quick Send modal (see `QuickSendModal` below).
- **Badge data source:** One new lightweight endpoint: `GET /api/admin/badge-counts`
  - Returns `{ pendingRequests: number, unreviewedVariances: number }`
  - `pendingRequests`: count of rows across `shift_swap_requests`, `time_off_requests`, `timesheet_change_requests` where `status = 'pending'`, scoped by `managerStoreIds`
  - `unreviewedVariances`: count of `shift_drawer_counts` where `notified_manager = true` AND `reviewed_at IS NULL`, scoped by store via shift join
  - This endpoint must follow the standard admin auth pattern: `getBearerToken` → `getUser` → `getManagerStoreIds`
  - Do NOT call `/api/admin/dashboard` for badge counts — that endpoint is expensive (full sales + health + action items)
  - New file: `src/app/api/admin/badge-counts/route.ts`
- Badge data fetched once on mount, intentionally stale until next page load (known tradeoff — not a bug)

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
- 5 tabs: Home · Requests (badged) · **Compose** · Payroll · More
- The center tab is the **Compose** button — `PenSquare` icon, no label or short "Send" label. Tapping it opens the Quick Send modal directly (same `QuickSendModal` as sidebar). This gives Quick Send a permanent, thumb-friendly position in the mobile nav.
- Active state: green accent for nav links, purple tint for Compose button to visually distinguish it as an action rather than a destination
- Mirrors the structure and CSS of `src/components/EmployeeBottomNav.tsx`
- **"More" tab:** Opens a slide-up panel using the shadcn `Sheet` component (`side="bottom"`). **`sheet.tsx` is not currently installed** — install it as the first step of Phase 1 before building `AdminBottomNav`: `npx shadcn@latest add sheet`. The sheet renders the full 5-group sidebar nav structure (same links as `AdminSidebar`). Sheet closes on: navigate to a link, tap the backdrop scrim, or tap a close button in the sheet header. Sheet sits at `z-[60]` (above the `z-50` bottom nav).

### `QuickSendModal` (shared component)
- **New file:** `src/components/QuickSendModal.tsx`
- Shared by `AdminSidebar` (desktop compose button) and `AdminBottomNav` (mobile center tab)
- Implemented as a shadcn `Dialog` (already installed at `src/components/ui/dialog.tsx`)
- **Contents** — identical logic to the Quick Send block previously in the Command Center body:
  - Type selector: Message / Task
  - Target type: Store / Employee
  - Store or Employee selector (conditional on target type)
  - Message textarea
  - Send button (violet, `sendQuickAssignment` logic)
  - Error display on failure
- Accepts `stores` and `users` as props (passed down from the layout, which fetches them once on mount alongside badge counts — reuse the same `/api/admin/users` call already in the dashboard)
- On successful send: shows a brief inline confirmation ("Sent ✓"), clears the form, closes after 1.5s
- Quick Send no longer appears as a standalone block in the Command Center body

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

**2. KPI row — 4 compact tiles**
- Layout: `grid grid-cols-2 lg:grid-cols-4` — 2×2 on mobile, single row on desktop
- Each tile is compact: large number on top, short label below, status color on the number. No sub-lines on mobile — keep it tight.
- Yesterday's Sales: value in green (`var(--green)`)
- Yesterday's Closeout: status word (PASS/WARN/FAIL/N/A) colored by outcome — green for PASS, amber for WARN, red for FAIL, muted for N/A
- Open Shifts: count in purple (`var(--purple)`)
- Pending Approvals: count in amber (`#ffa050`) if > 0, muted if 0
- Card style: `bg-[var(--card)] border border-white/8 rounded-xl p-3` — compact padding, no glow borders
- On desktop, Yesterday's Sales tile can show the Cash · Card · X-Report Carry sub-line (hidden on mobile via `hidden lg:block`)

**3. Immediate Action Items (full width, directly below KPI row)**
- Moved up from the bottom-right of the old layout — this is a priority management tool and should be the first thing seen after the KPI snapshot
- Filterable by People / Money / Scheduling / Approvals (badge counts on each filter tab)
- Each item shows title, severity badge, category label, description
- "Mark Reviewed" inline action for unscheduled shifts
- Direct action links: "Open Shift Detail", "Review Closeout", "Approve / Deny"
- Clicking an item opens the quick-view Dialog
- **Zero-item state:** Renders as a single compact green bar — `bg-[var(--green)]/10 border border-[var(--green)]/30 rounded-xl px-4 py-2 text-sm font-medium text-[var(--green)]` — reading "Immediate Action Items: All Clear". No expanded section, no collapsible chrome. Takes up one line of height.
- **Non-zero state:** Full section rendered as described above. Collapsible, expanded by default.

**4. Main body — 2/3 + 1/3 grid**

*Left column (2/3):*
- **Sales Block**: tabbed Table/Chart view, date+store scoped
  - Table: Date, Store, Day, Cash, Card, X-Report Carry, Total, Status — with totals row
  - Chart: Area (total) + per-store or cash/card lines; Total/Detailed mode toggle

*Right column (1/3):*
- **Store Health**: per-store grade (A–D), weighted score, top drag signals with mini progress bars; grade tone colors preserved (emerald/sky/amber/red)

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
- Page title: Barlow Condensed using `font-[family-name:var(--font-display)]` (the CSS variable is `--font-display`, registered in `src/app/layout.tsx` — NOT `--font-barlow`). Apply `text-2xl font-bold uppercase tracking-tight text-[var(--text)]`, consistent with employee page headers.
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

**Sequencing requirement:** The `dashboard/page.tsx` → `redirect('/admin')` conversion happens in Phase 2, **only after Phase 1 layout auth is confirmed working** (test: open `/admin` in an incognito tab, confirm redirect to `/login`). Converting the redirect before the layout auth is reliable risks a redirect loop on `/admin` if auth hasn't fired yet.

### Phase 3 — Live Ops Pages
**Pages:** Requests, Variances, Open Shifts, Overrides, Coverage Shifts (5 pages)
Note: `src/app/admin/shifts/[shiftId]/page.tsx` is a nested detail page (not in sidebar nav). It receives the same visual treatment (Barlow Condensed header, updated card borders, remove back-to-hub link) but is converted in Phase 4 alongside the Shifts page.

### Phase 4 — Scheduling + Payroll & Finance
**Pages:** Scheduler, Shifts, `shifts/[shiftId]` (detail), Employee Schedules, Assignments, Payroll, Reconciliation, Safe Ledger, Shift Sales (9 pages)

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
