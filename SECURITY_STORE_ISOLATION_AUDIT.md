# Service-Role + Store Isolation Route Audit

Date: 2026-02-08
Scope: `src/app/api/**/route.ts`

## 1) Routes Using Service-Role Client (`supabaseServer`)
These routes import/use `src/lib/supabaseServer.ts` (service-role key, RLS bypass):

- `src/app/api/time-off-blocks/route.ts`
- `src/app/api/end-shift/route.ts`
- `src/app/api/confirm-changeover/route.ts`
- `src/app/api/checklist/check-item/route.ts`
- `src/app/api/cron/send-nudges/route.ts`
- `src/app/api/cron/expire-requests/route.ts`
- `src/app/api/start-shift/route.ts`
- `src/app/api/shift/[shiftId]/route.ts`
- `src/app/api/shift/open/route.ts`
- `src/app/api/admin/missing-counts/route.ts`
- `src/app/api/requests/shift-swap/route.ts`
- `src/app/api/messages/[id]/dismiss/route.ts`
- `src/app/api/admin/employee-schedules/route.ts`
- `src/app/api/requests/time-off/route.ts`
- `src/app/api/shift/[shiftId]/assignments/[assignmentId]/route.ts`
- `src/app/api/requests/timesheet/[id]/route.ts`
- `src/app/api/requests/timesheet/[id]/deny/route.ts`
- `src/app/api/admin/variances/[countId]/review/route.ts`
- `src/app/api/admin/variances/route.ts`
- `src/app/api/requests/shift-swap/open/route.ts`
- `src/app/api/admin/overrides/[shiftId]/approve/route.ts`
- `src/app/api/requests/timesheet/route.ts`
- `src/app/api/requests/time-off/[id]/route.ts`
- `src/app/api/admin/overrides/route.ts`
- `src/app/api/admin/assignments/[assignmentId]/route.ts`
- `src/app/api/requests/timesheet/[id]/approve/route.ts`
- `src/app/api/requests/timesheet/[id]/cancel/route.ts`
- `src/app/api/requests/time-off/[id]/approve/route.ts`
- `src/app/api/admin/assignments/route.ts`
- `src/app/api/admin/open-shifts/route.ts`
- `src/app/api/admin/schedules/route.ts`
- `src/app/api/requests/time-off/[id]/deny/route.ts`
- `src/app/api/requests/shift-swap/[id]/offers/route.ts`
- `src/app/api/me/profile/route.ts`
- `src/app/api/admin/users/[profileId]/route.ts`
- `src/app/api/admin/assignments/bulk-delete/route.ts`
- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/payroll/route.ts`
- `src/app/api/admin/schedules/[id]/route.ts`
- `src/app/api/requests/time-off/[id]/cancel/route.ts`
- `src/app/api/admin/shifts/route.ts`
- `src/app/api/requests/shift-swap/[id]/offers/decline/route.ts`
- `src/app/api/admin/open-shifts/[shiftId]/end/route.ts`
- `src/app/api/requests/shift-swap/[id]/deny/route.ts`
- `src/app/api/requests/shift-swap/[id]/route.ts`
- `src/app/api/requests/shift-swap/[id]/approve/route.ts`
- `src/app/api/admin/schedules/[id]/publish/route.ts`
- `src/app/api/admin/schedules/[id]/assign-batch/route.ts`
- `src/app/api/admin/settings/route.ts`
- `src/app/api/admin/schedules/[id]/totals/route.ts`
- `src/app/api/requests/shift-swap/[id]/cancel/route.ts`
- `src/app/api/admin/settings/checklists/route.ts`
- `src/app/api/requests/shift-swap/[id]/select/route.ts`
- `src/app/api/admin/settings/store/route.ts`
- `src/app/api/admin/shifts/[shiftId]/route.ts`

## 2) Routes Missing/Weak Store-ID Isolation

### A) Critical: Missing auth + ownership/store guard
- `src/app/api/checklist/check-item/route.ts`
- `src/app/api/confirm-changeover/route.ts`
- `src/app/api/shift/[shiftId]/assignments/[assignmentId]/route.ts`

### B) Manager authenticated, but no target store ownership check
- `src/app/api/admin/open-shifts/route.ts`
  - Lists open shifts without filtering to manager-managed stores.
- `src/app/api/admin/open-shifts/[shiftId]/end/route.ts`
  - Ends shift by ID with no `store_id in managerStoreIds` assertion.
- `src/app/api/admin/variances/[countId]/review/route.ts`
  - Reviews variance by ID with no managed-store ownership assertion.

### C) Structural risk (not immediate bug): employee store scope trusted from JWT claims
- Employee routes using `authenticateShiftRequest` rely on token `store_ids` from `src/lib/shiftAuth.ts`.
- No live membership re-check in auth helper; membership changes depend on token refresh/rotation.

## 3) Notes
- Request approve/deny manager routes for `shift-swap`, `time-off`, and `timesheet` already have defensive store checks.
- Most request RPCs also enforce membership/store-manager checks in SQL.
- This file is inventory only (no code changes).
