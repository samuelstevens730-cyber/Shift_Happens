# Requests & Approvals Module - Agent Primer

## Critical Architecture Rules

### Authentication Flow
- Employees: `authenticateShiftRequest()` in `src/lib/shiftAuth.ts` → returns `AuthContext`
- Managers: Supabase auth via `auth.getUser()` → lookup `store_managers`
- **RPCs receive explicit actor IDs** - never use `auth.uid()` or `request.jwt.claims` in RPCs

### RPC Pattern (MANDATORY)
All RPCs accept actor identity as parameters:
```sql
CREATE FUNCTION submit_swap_request(
  p_actor_profile_id UUID,  -- FROM authenticateShiftRequest()
  p_schedule_shift_id UUID,
  ...
)
```
API routes call: `supabaseServer.rpc('submit_swap_request', { p_actor_profile_id: auth.profileId, ... })`

### Database Conventions
- UUIDs everywhere
- TIMESTAMPTZ for times (UTC stored, America/Chicago display)
- DATE for date-only fields
- Soft deletes via `deleted_at`

### Key Constraints
1. **BILOCATION**: No overlapping shifts across stores (same employee)
2. **SOLO COVERAGE**: No 2+ employees at same store/time/shift_type
3. **TIME OFF GATE**: Block if ANY published schedule_shift overlaps (published only)
4. **PAYROLL LOCK**: 1st-15th or 16th-EOM in America/Chicago (NOT schedules.period_start)
5. **OVERNIGHT SHIFTS**: Check `is_overnight` flag or `end_time < start_time`

### State Machines
- Shift swap: open → pending → approved | cancelled | expired
- Shift swap denial: pending → open (clears selection, NOT 'denied')
- Time off: pending → approved | denied | cancelled
- Timesheet: pending → approved | denied | cancelled

### File Locations
- SQL: `src/app/sql/22_*.sql` through `34_*.sql`
- API: `src/app/api/requests/[type]/...`
- Frontend: `src/app/dashboard/requests/`, `src/app/admin/requests/`

### DO NOT
- Use `auth.uid()` in RPCs (always NULL with service role)
- Modify `shifts` table for swaps (only `schedule_shifts`)
- Skip audit log writes
- Use raw SQL in API routes (use RPCs via `supabaseServer.rpc()`)
- Assume standard overlap logic works for overnight shifts

---

PROMPT 5: Audit Logs Table

PROMPT 6: Validation Functions

PROMPT 7: Shift Swap RPCs

PROMPT 8: Time Off RPCs
OBJECTIVE: Create SQL RPCs for time off operations
FILE TO CREATE: src/app/sql/29_time_off_rpc.sql
FUNCTIONS:

submit_time_off_request(p_actor_profile_id UUID, p_store_id UUID, p_start_date DATE, p_end_date DATE, p_reason TEXT) RETURNS UUID

Validate end_date >= start_date
Validate actor is member of store
TIME OFF GATE: Call check_time_off_schedule_conflict - RAISE if published shifts overlap
Insert time_off_requests with store_id
Insert audit log
Return request_id


approve_time_off_request(p_actor_auth_user_id UUID, p_request_id UUID) RETURNS UUID

Lock request FOR UPDATE
Validate status='pending'
Validate manager has store access
Insert time_off_blocks
Update status='approved'
Insert audit log
Return block_id


cancel_time_off_request(p_actor_profile_id UUID, p_request_id UUID) RETURNS BOOLEAN

Validate actor owns request
Validate status='pending'
Update status='cancelled'
Insert audit log



DONE WHEN:

TIME OFF GATE enforced (published schedules only)
store_id passed and stored
Explicit actor parameters used


PROMPT 9: Timesheet RPCs
PROMPT 10: Deny RPC
                                      

PROMPT 11: Cron Functions


PROMPT 12: RLS Policies


PROMPT 14: API Routes - Time Off
OBJECTIVE: Create API routes for time off
FILES TO CREATE:

src/app/api/requests/time-off/route.ts (GET list, POST submit)
src/app/api/requests/time-off/[id]/route.ts (GET single)
src/app/api/requests/time-off/[id]/approve/route.ts (POST)
src/app/api/requests/time-off/[id]/deny/route.ts (POST)
src/app/api/requests/time-off/[id]/cancel/route.ts (POST)
src/app/api/time-off-blocks/route.ts (GET blocks)

PATTERN: Same as Prompt 13 - explicit actor parameters
DONE WHEN:

TIME OFF GATE errors return helpful message with conflicting shift dates
store_id passed to submit RPC


PROMPT 15: API Routes - Timesheet
OBJECTIVE: Create API routes for timesheet corrections
FILES TO CREATE:

src/app/api/requests/timesheet/route.ts (GET list, POST submit)
src/app/api/requests/timesheet/[id]/route.ts (GET single)
src/app/api/requests/timesheet/[id]/approve/route.ts (POST)
src/app/api/requests/timesheet/[id]/deny/route.ts (POST)
src/app/api/requests/timesheet/[id]/cancel/route.ts (POST)

PATTERN: Same as Prompt 13 - explicit actor parameters
DONE WHEN:

PAYROLL LOCK errors return period info
Original vs requested times shown in GET response


PROMPT 16: Zod Schemas
OBJECTIVE: Create validation schemas
FILE TO CREATE: src/schemas/requests.ts
SCHEMAS:

submitSwapRequestSchema - scheduleShiftId, reason?, expiresHours?
submitSwapOfferSchema - requestId, offerType, swapScheduleShiftId?, note?
selectOfferSchema - offerId
submitTimeOffRequestSchema - storeId, startDate, endDate, reason?
submitTimesheetChangeSchema - shiftId, requestedStartedAt?, requestedEndedAt?, reason
denyRequestSchema - reason?

DONE WHEN:

All schemas exported
Refinements for conditional requirements (swap needs swapScheduleShiftId)


PROMPT 17: Frontend - Employee Requests Page
OBJECTIVE: Create employee requests dashboard
FILES TO CREATE:

src/app/dashboard/requests/page.tsx
src/app/dashboard/requests/SwapRequestCard.tsx
src/app/dashboard/requests/TimeOffRequestForm.tsx
src/app/dashboard/requests/TimesheetCorrectionForm.tsx
src/hooks/useShiftSwapRequests.ts
src/hooks/useTimeOffRequests.ts
src/hooks/useTimesheetRequests.ts
src/hooks/useRequestMutations.ts

REFERENCE: src/app/dashboard/schedule/page.tsx for layout patterns
DONE WHEN:

Employee can view/create all request types
Error states show TIME OFF GATE and PAYROLL LOCK messages clearly
Tab navigation works


PROMPT 18: Frontend - Admin Requests Page
OBJECTIVE: Create manager approval queue
FILES TO CREATE:

src/app/admin/requests/page.tsx
src/app/admin/requests/SwapApprovalCard.tsx
src/app/admin/requests/TimeOffApprovalCard.tsx
src/app/admin/requests/TimesheetApprovalCard.tsx

REFERENCE: src/app/admin/ for existing admin patterns
DONE WHEN:

Manager sees pending requests for their stores
Approve/Deny with confirmation and optional reason
Cards show relevant details (shift times, date ranges, before/after times)


PROMPT 19: Schedule Integration
OBJECTIVE: Add "Request Swap" to employee schedule view
FILE TO MODIFY: src/app/dashboard/schedule/page.tsx
CHANGES:

Add "Request Swap" button on employee's published shifts
Only show for future shifts without active swap request
Modal for reason + submit
Visual indicator for pending swap requests

DONE WHEN:

Button appears on appropriate shifts
Modal submits to API correctly
Pending requests show badge/indicator


PROMPT 20: Cron Setup
OBJECTIVE: Configure Vercel cron jobs
FILES TO CREATE:

src/app/api/cron/expire-requests/route.ts
src/app/api/cron/send-nudges/route.ts

FILE TO MODIFY: vercel.json
CRON ROUTES:

POST /api/cron/expire-requests - verify CRON_SECRET, call process_expired_requests()
POST /api/cron/send-nudges - verify CRON_SECRET, call send_selection_nudges()




Execution Order
Phase 1: Schema (SQL)

Prompt 1: Enums
Prompt 2: Swap tables (includes nudge_sent_at)
Prompt 3: Time off tables (includes store_id)
Prompt 4: Timesheet tables (includes store_id)
Prompt 5: Audit logs

Phase 2: Business Logic (SQL)
6. Prompt 6: Validation functions (overnight handling)
7. Prompt 7: Swap RPCs (explicit actors, solo coverage)
8. Prompt 8: Time off RPCs (explicit actors, TIME OFF GATE)
9. Prompt 9: Timesheet RPCs (explicit actors, stale guard)
10. Prompt 10: Deny RPC
11. Prompt 11: Cron functions (idempotent nudges)
12. Prompt 12: RLS policies
Phase 3: API
13. Prompt 13: Swap routes
14. Prompt 14: Time off routes
15. Prompt 15: Timesheet routes
Phase 4: Frontend
16. Prompt 16: Zod schemas
17. Prompt 17: Employee page
18. Prompt 18: Admin page
19. Prompt 19: Schedule integration
Phase 5: Infrastructure
20. Prompt 20: Cron setup

Critical Files to Reference

src/lib/shiftAuth.ts - Authentication pattern (authenticateShiftRequest)
src/lib/supabaseServer.ts - Service role client
src/app/api/start-shift/route.ts - API route pattern
src/app/sql/07_shift_assignments.sql - Notification pattern
src/app/sql/18_v2_workforce_migration.sql - schedule_shifts schema
src/app/sql/21_schedule_rls.sql - RLS pattern