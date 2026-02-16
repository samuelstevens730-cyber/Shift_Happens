# Safe Ledger + Admin Dashboard Build Plan (Today)

## Mission
Build the new `Command Center` dashboard at `\/admin/dashboard` using `shadcn/ui`, while keeping existing admin pages stable and available.

This is a **read-first operational layer** over data we already track.  
No big schema redesign required.

---

## Ground Rules
- Keep `\/admin` as the full nav hub; add `\/admin/dashboard` as the new landing insight page.
- Use `shadcn/ui` for new dashboard components only (migrate other pages later, one at a time).
- Reuse existing auth/store scope patterns (`src/lib/adminAuth.ts`).
- Reuse CST date logic patterns from `src/lib/clockWindows.ts`.
- Keep API explicit and typed; one aggregate endpoint for dashboard load.

## Responsive Contract (Must-Have)
- Desktop-first and mobile-safe by design.
- Desktop (`lg+`): horizontal dense dashboard that maximizes at-a-glance visibility with minimal page scroll.
- Mobile (`<lg`): vertical single-column flow in this order:
  1. Header + filters
  2. Topline scan cards
  3. Store health cards
  4. Immediate action items
  5. Sales block
- Use CSS Grid breakpoints, not separate pages.
- On desktop, long lists (especially action items) should use internal scroll containers.
- On mobile, avoid nested scroll traps; prefer natural page scroll.

---

## Before We Start Coding
1. Run `src/app/sql/53_safe_closeout_add_two_dollar_support.sql` in DB (if not already run).
2. Confirm employee closeout accepts `$2` in live flow.
3. Confirm safe ledger reconciliation still shows:
   - Expected total = `sum(cash_sales_cents - expense_total_cents)`
   - Actual total = `sum(denom_total_cents)`

---

## Phase 0: shadcn Foundation (Minimal)
Goal: Add only what dashboard needs now.

1. Install deps:
   - `clsx`
   - `tailwind-merge`
   - `class-variance-authority`
2. Add `src/lib/utils.ts` with `cn()`.
3. Add shadcn config/components:
   - `card`, `tabs`, `badge`, `select`, `collapsible`, `separator`
4. Keep existing UI components untouched; no full theme overhaul today.

Validation:
- `npx tsc --noEmit`
- `npm run build` (ignore external font/network fetch noise)

---

## Phase 1: Dashboard API Contract + Endpoint
### New Type Contract
Create `src/types/adminDashboard.ts` with typed response for:
- `stores`
- `topline`
- `openShifts`
- `pendingApprovals`
- `actions`
- `actionCounts`
- `salesHistory`
- `health`

### Endpoint
Create `src/app/api/admin/dashboard/route.ts`

Query params:
- `storeId` (`all` or specific UUID)
- `from`
- `to`

Auth:
- manager token + store scoping through `getManagerStoreIds`.

Response blocks:
1. **Topline**
   - Yesterday sales (cash/card/other from `safe_closeouts`)
   - Yesterday closeout status + variance
   - Open shifts count
   - Pending approvals count (swap/time-off/timesheet)
2. **Sales history**
   - Daily rows for table/chart
3. **Action items**
   - People, Money, Scheduling, Approvals (top 3 each for now)
4. **Store health**
   - Option B weighted score + grade per store

Implementation notes:
- Use `Promise.all` for parallel queries.
- Use CST business date boundaries consistently.

---

## Phase 2: Dashboard Shell UI (`\/admin/dashboard`)
Create `src/app/admin/dashboard/page.tsx`

Layout:
1. Header row
   - Title: `Command Center`
   - Date range picker (default last 7 days)
   - Store selector (`All`, LV1, LV2...)
   - Link back to `\/admin`
2. Topline scan cards
   - Yesterday Sales
   - Yesterday Safe Closeout
   - Open Shifts
   - Pending Approvals
3. Middle row
   - Immediate Action Items (collapsible + scrollable)
4. Bottom row
   - Sales block (table tab active, chart tab placeholder if needed)
5. Store health cards row
   - One card per store (or one for selected store)

---

## Phase 3: Store Health (Option B Weighted Model)
Use weighted scoring server-side (0-100), return both grade + signal breakdown.

Recommended weights:
- Unapproved long shifts: 15
- Stale shifts >13h: 10
- Manual closes unreviewed: 10
- Drawer variance rate (7d): 15
- Safe closeout variance rate (7d): 15
- Approval backlog age: 15
- No-show rate (7d): 10 (exclude if no published schedules)
- Cleaning compliance (7d): 10

Grades:
- `A` >= 90
- `B` >= 70
- `C` >= 50
- `D` < 50

Card UI:
- Big letter grade
- Color border by grade
- 2-3 “dragging signals” lines

---

## Phase 4: Immediate Action Items
Build `ImmediateActionList` in dashboard page (can split component if needed).

Groups:
- High priority: open shifts (stale), failed/warn closeouts needing review
- Medium priority: pending swaps/time-off/timesheet requests

Behavior:
- Collapsible card
- Scrollable list
- Clicking item opens stub quick-view modal (Phase 1 stub only)

---

## Phase 5: Sales Block (Phase 1 Scope)
Phase 1:
- Tabbed container
- Sales table (date, cash, card, other, total, status)
- Chart tab can be placeholder or simple line if time permits

Phase 2:
- Add `recharts` and render real line chart.

---

## Lucide Icon Strategy (Adopt Now)
Use a centralized icon map for consistency.

Suggested mapping:
- Sales: `TrendingUp`
- Safe Ledger: `Wallet`
- Requests: `ClipboardList`
- Shifts: `Clock3`
- Approvals: `CheckCircle2`
- Alerts: `TriangleAlert`
- Messages: `MessageSquare`
- Tasks: `ListTodo`
- Store Health: `Activity`

Sizes:
- Nav/tile `h-4 w-4`
- Card header `h-5 w-5`
- Topline highlight `h-6 w-6`

---

## Build Order (Today)
1. Phase 0 shadcn foundation
2. Phase 1 API contract + `\/api/admin/dashboard`
3. Phase 2 dashboard shell + filters + topline
4. Phase 3 store health cards
5. Phase 4 immediate action list
6. Phase 5 sales table block
7. Add icons polish

Stretch:
- chart rendering
- quick-send widget
- full queue drilldown page

---

## Verification Checklist
- `npx tsc --noEmit`
- `npm run build`
- Dashboard loads for manager auth only.
- Store selector filters every widget.
- Date range affects topline/sales/health/actions consistently.
- Topline totals match existing source pages:
  - safe ledger
  - open shifts
  - requests
- Store health grade changes when known issues are resolved.
- Works at 375px width and desktop.

---

## Out of Scope for Today
- Rebuilding all admin pages in shadcn
- Queue drilldown full page with inline approvals
- Major clock window refactor

---

## Done Definition (Today)
We ship a usable `\/admin/dashboard` that gives managers a 5-minute operational snapshot:
- what happened yesterday,
- what needs attention right now,
- and store health at a glance.
