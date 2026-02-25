Context
Full security audit of all API routes and SQL RLS policies. Prior work (Pass 3) fixed the two critical DB-level issues (F-06: missing search_path on clock_window_check, F-07: timezone cast bugs) in migration 42_security_and_timezone_fixes.sql. However, the codebase has grown significantly since then — 85+ API routes, migrations up to 59 — and new surfaces were introduced without consistent security coverage. This plan covers everything found in the current state of the codebase.
Auth model recap:

Employee routes: authenticateShiftRequest() in src/lib/shiftAuth.ts — tries ES256 PIN JWT, falls back to Supabase manager auth
Admin routes: getManagerStoreIds() in src/lib/adminAuth.ts — validates Supabase session + checks store_managers table
supabaseServer = service role = bypasses ALL RLS — every query using it must manually filter by storeIds
RLS only fires for authenticated role (managers via Supabase auth). Employees use service-role RPCs, not RLS, for DB writes.


AUDIT FINDINGS SUMMARY
CRITICAL — Fix immediately (active security holes)
#LocationIssueC1src/app/api/admin/open-shifts/route.ts GETNo manager store scope — returns ALL shifts from ALL storesC2src/app/api/admin/open-shifts/[shiftId]/end/route.ts POSTNo store ownership validation — any manager can end any shiftC3src/app/api/admin/variances/[countId]/review/route.ts POSTNo manager scope check — any authenticated user can approve any varianceC4src/app/sql/ — payroll_advances tableNO RLS — sensitive financial data fully exposedC5src/app/sql/ — safe_pickups tableNO RLS — cash pickup records exposedC6src/app/sql/ — daily_sales_records tableNO RLS — financial aggregates exposedC7src/app/sql/ — shift_sales_counts tableNO RLS — financial data exposed
HIGH — Fix in same sprint
#LocationIssueH1src/app/api/admin/schedules/route.tsBypasses getManagerStoreIds() helper — manual store_managers query creates drift riskH2src/app/api/health/route.tsNo auth — exposes env var presence (hasServiceRole, nodeEnv) to public internet
MEDIUM — Fix this sprint or next
#LocationIssueM1src/app/api/admin/safe-ledger/route.ts POSTNon-null assertions (body.store_id!, body.profile_id!) without prior null check — can bypass store validationM2src/app/api/admin/safe-ledger/[id]/route.ts PATCHSilent JSON parse error (catch(() => ({}))) — malformed request silently succeeds as no-opM3src/app/api/admin/payroll/advances/[id]/route.ts PATCH/DELETEvalidateAccess() fails open if advance.store_id is NULL in DBM4src/app/sql/ — cleaning_task_completionsNo RLS (validation delegated to RPCs only)M5src/app/sql/ — store_cleaning_schedulesNo RLSM6src/app/sql/ — shift_checklist_checksNo RLSM7src/app/sql/ — shift_change_audit_logsNo RLSM8src/app/sql/ — profiles clock-in policyAnonymous SELECT on ALL profiles columns — scope may be broader than needed
LOW — Document or defer
#LocationIssueL1src/app/sql/ — clock_windows, cleaning_tasks, store_rollover_configNo RLS, but config/reference tables — likely intentional; should be documentedL2src/app/sql/ — checklist_templates, checklist_itemsNo RLS — scope (global vs store-specific) undocumentedL3src/app/sql/16_clock_windows.sqlOld clock_window_check() definition missing search_path (superseded by migration 42 — verify 42 actually replaces it)

Step-by-Step Hardening Plan

STEP 1 — Fix Critical Admin Route: open-shifts [2 files]
Problem: GET /api/admin/open-shifts returns every open shift in the database. POST /api/admin/open-shifts/[shiftId]/end ends any shift in the database. Neither checks which stores the requesting manager actually manages.
Fix pattern (same pattern used in src/app/api/admin/shifts/route.ts which is secure):

Call getManagerStoreIds(req) from src/lib/adminAuth.ts
On GET: add .in('store_id', managerStoreIds) to the shifts query
On POST [shiftId]/end: after fetching the shift, verify managerStoreIds.includes(shift.store_id) before proceeding

Files to modify:

src/app/api/admin/open-shifts/route.ts
src/app/api/admin/open-shifts/[shiftId]/end/route.ts

Reference pattern: src/app/api/admin/shifts/route.ts — secure version of the same pattern

STEP 2 — Fix Critical Admin Route: variances review [1 file]
Problem: POST /api/admin/variances/[countId]/review marks a drawer count variance as reviewed without verifying the requesting manager owns the relevant store. Any authenticated user can approve any store's variance.
Fix pattern:

Call getManagerStoreIds(req)
Fetch the shift_drawer_counts record by countId, join to shifts to get store_id
Verify managerStoreIds.includes(shift.store_id) — return 403 if not
Proceed with the update only if check passes

Files to modify:

src/app/api/admin/variances/[countId]/review/route.ts


STEP 3 — Fix High: schedules route auth pattern [1 file]
Problem: src/app/api/admin/schedules/route.ts manually queries store_managers table instead of using the shared getManagerStoreIds() helper. If the helper's logic ever changes, this route silently drifts.
Fix:

Import getManagerStoreIds from src/lib/adminAuth.ts
Replace the inline store_managers query with const managerStoreIds = await getManagerStoreIds(req)
Use managerStoreIds everywhere the manual query result was used

Files to modify:

src/app/api/admin/schedules/route.ts


STEP 4 — Fix High: health endpoint [1 file]
Problem: GET /api/health is fully public and returns { hasServiceRole: boolean, nodeEnv: string }. This leaks environment configuration to anyone who can reach the server.
Fix options (choose one):

Option A (simplest): Return only { ok: true, ts: Date.now() } — strip all env introspection
Option B: Require CRON_SECRET header (same pattern as cron routes) so it's internal-only

Recommended: Option A. Health checks shouldn't need env introspection at the HTTP layer.
Files to modify:

src/app/api/health/route.ts


STEP 5 — Fix Medium: safe-ledger input validation [2 files]
Problem A (route.ts POST): Uses non-null assertion body.store_id! before the store membership check. If store_id is absent/null in the request body, the assertion hides this and the membership check (!managerStoreIds.includes(null)) returns false correctly — but the code throws an unhandled error downstream instead of returning a clean 400.
Problem B ([id]/route.ts PATCH): await req.json().catch(() => ({})) swallows JSON parse errors — a malformed PATCH body silently treats the request as "no fields to update" and returns success.
Fix A: Add explicit null check: if (!body.store_id || !body.profile_id) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 }) before the membership check. Remove non-null assertions.
Fix B: Replace .catch(() => ({})) with explicit try/catch that returns { status: 400, error: 'Invalid JSON' } on parse failure.
Files to modify:

src/app/api/admin/safe-ledger/route.ts
src/app/api/admin/safe-ledger/[id]/route.ts


STEP 6 — Fix Medium: payroll advances null store_id [1 file]
Problem: validateAccess() in the advances [id] route checks if (!data.store_id || !storeIds.includes(data.store_id)). If store_id is somehow NULL in the DB (constraint should prevent this but doesn't always), the check returns 403 as expected — this is actually correct behavior. However, the error message returned doesn't distinguish between "no access" and "data corruption", and there's no alerting.
Fix: Add an explicit if (data.store_id === null) branch that returns 500 (server error / data integrity issue) and logs a warning, separate from the 403 (access denied) path. This makes silent data corruption visible.
Files to modify:

src/app/api/admin/payroll/advances/[id]/route.ts


STEP 7 — RLS Migration: Financial Tables [1 SQL migration file]
Problem: payroll_advances, safe_pickups, daily_sales_records, shift_sales_counts — all financial tables — have NO RLS. All authenticated database sessions (including accidental future uses of the authenticated role) can read/write all financial records across all stores.
New migration: src/app/sql/60_financial_tables_rls.sql
Policies to add:
payroll_advances:

ALTER TABLE payroll_advances ENABLE ROW LEVEL SECURITY
SELECT for managers: store_id IN (SELECT store_id FROM store_managers WHERE user_id = auth.uid())
SELECT for employees: using JWT claim (same pattern as safe_closeouts_employee_select_own)
INSERT/UPDATE: manager only

safe_pickups:

ALTER TABLE safe_pickups ENABLE ROW LEVEL SECURITY
SELECT/INSERT for managers (store scope)
SELECT for employee: own recorded_by match

daily_sales_records:

ALTER TABLE daily_sales_records ENABLE ROW LEVEL SECURITY
SELECT for managers (store scope)
No direct employee SELECT (employees use RPCs)

shift_sales_counts:

ALTER TABLE shift_sales_counts ENABLE ROW LEVEL SECURITY
SELECT for managers (via shift → store_id subquery)
No direct employee SELECT (employees use RPCs)

Reference patterns: src/app/sql/47_safe_ledger_closeout.sql (safe_closeouts policies) and src/app/sql/11_rls.sql

STEP 8 — RLS Migration: Operational Tables [1 SQL migration file]
Problem: cleaning_task_completions, store_cleaning_schedules, shift_checklist_checks, shift_change_audit_logs — no RLS. Validation currently delegated entirely to RPCs and API layer, with no DB-level defense.
New migration: src/app/sql/61_operational_tables_rls.sql
Policies to add:
cleaning_task_completions:

Enable RLS
SELECT/INSERT: employee via shift → profile_id match OR manager via shift → store_id scope

store_cleaning_schedules:

Enable RLS
ALL for managers (store scope)
SELECT for employees (store_ids claim)

shift_checklist_checks:

Enable RLS
SELECT/INSERT/UPDATE: employee via shift ownership, manager via store scope

shift_change_audit_logs:

Enable RLS (or explicitly document as intentionally unrestricted with GRANT SELECT TO authenticated)
If restricted: manager SELECT via store scope, no employee access

Note on RPCs with set row_security = off: The cleaning RPCs (fetch_cleaning_tasks_for_shift, complete_cleaning_task, skip_cleaning_task) in src/app/sql/41_cleaning_tasks.sql explicitly disable RLS and perform manual auth checks. Adding RLS to the underlying tables does NOT break these RPCs — they will continue to bypass RLS as SECURITY DEFINER functions. The RLS adds a second layer of defense for any non-RPC access path.

STEP 9 — Review profiles clock-in policy [informational + optional fix]
Problem: profiles_select_clock_in allows anon and authenticated roles to SELECT all columns from profiles. This was designed to support the clock-in flow where an employee can search for their own profile before logging in. However, it exposes ALL profile columns (potentially including PII) to unauthenticated users.
Recommended fix: Restrict the clock-in policy to only the columns actually needed for clock-in lookup (e.g., id, display_name, store_id) using a column-level SELECT grant, or move the clock-in lookup into a SECURITY DEFINER RPC that returns only the minimum fields.
This is a MEDIUM risk item — employees ARE the ones clocking in, so the exposure is primarily to your own workforce. But it's best practice to limit column exposure.
Files to modify: src/app/sql/ — new migration or amend existing RLS migration

Sub-Agent Prompts
One structured prompt per step, ready for handoff to implementation agents.

Prompt for Step 1 — Fix open-shifts routes
TASK: Fix store scope bypass in open-shifts admin API routes.

CONTEXT: This is a Next.js/Supabase app. Admin routes use `getManagerStoreIds(req)` from
`src/lib/adminAuth.ts` to get the list of stores a manager is authorized to see.
The service role client (`supabaseServer`) bypasses RLS, so every admin query MUST manually
filter by the manager's storeIds.

PROBLEM:
- `src/app/api/admin/open-shifts/route.ts` (GET) returns ALL open shifts with no store filter.
- `src/app/api/admin/open-shifts/[shiftId]/end/route.ts` (POST) ends any shift without
  verifying the manager owns the shift's store.

REFERENCE PATTERN (secure, copy this pattern):
Read `src/app/api/admin/shifts/route.ts` — it correctly calls `getManagerStoreIds(req)`,
then uses `in('store_id', managerStoreIds)` on all queries.

FIX:
1. Read both files: `open-shifts/route.ts` and `open-shifts/[shiftId]/end/route.ts`
2. For `open-shifts/route.ts`:
   - Import `getManagerStoreIds` from `src/lib/adminAuth.ts`
   - Call it at the top of the GET handler
   - Add `.in('store_id', managerStoreIds)` to the shifts query
3. For `open-shifts/[shiftId]/end/route.ts`:
   - Import `getManagerStoreIds` from `src/lib/adminAuth.ts`
   - Call it at the top of the POST handler
   - After fetching the shift record, verify: if (!managerStoreIds.includes(shift.store_id))
     return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
   - Only proceed with the end-shift logic if the check passes

DO NOT: Change any business logic, add new features, or modify unrelated code.
Verify: `npx tsc --noEmit` after changes.

Prompt for Step 2 — Fix variances review route
TASK: Fix missing store ownership check in variance review admin route.

CONTEXT: Admin routes use `getBearerToken` + `supabaseServer.auth.getUser(token)` +
`getManagerStoreIds(userId)` from `src/lib/adminAuth.ts`.
IMPORTANT: `getManagerStoreIds` takes a userId STRING (not a Request object).
The correct pattern is:
  const token = getBearerToken(req)
  const { data: { user } } = await supabaseServer.auth.getUser(token)
  const managerStoreIds = await getManagerStoreIds(user.id)
See `src/app/api/admin/open-shifts/route.ts` for the exact working pattern.

The target file is `src/app/api/admin/variances/[countId]/review/route.ts`.

PROBLEM: This POST route marks a shift_drawer_counts record as reviewed but never
checks that the requesting manager owns the store associated with that count.

FIX:
1. Read the file: `src/app/api/admin/variances/[countId]/review/route.ts`
2. Read the reference: `src/lib/adminAuth.ts` and `src/app/api/admin/open-shifts/route.ts`
3. At the start of the POST handler:
   - Extract token with `getBearerToken(req)`, validate with `supabaseServer.auth.getUser(token)`
   - Get `managerStoreIds` via `getManagerStoreIds(user.id)`
   - After fetching the drawer count record, join or follow the FK to get the
     associated shift's store_id
   - Check: if (!managerStoreIds.includes(storeId)) return 403 Forbidden
   - Only proceed with the review update if check passes

DO NOT: Change any other logic. Do not modify the GET route if one exists.
Verify: `npx tsc --noEmit` after changes.

Prompt for Step 3 — Fix schedules route auth pattern
TASK: Refactor admin schedules route to use the shared auth helper.

CONTEXT: `src/lib/adminAuth.ts` exports `getManagerStoreIds(req)` which is the
canonical way to get a manager's authorized store IDs. All admin routes should use this.

PROBLEM: `src/app/api/admin/schedules/route.ts` manually queries the `store_managers`
table instead of using the shared helper. This creates a maintenance risk — if the
helper's logic changes, this route won't track.

FIX:
1. Read the file: `src/app/api/admin/schedules/route.ts`
2. Read: `src/lib/adminAuth.ts` to see what `getManagerStoreIds` returns
3. Import `getBearerToken, getManagerStoreIds` from `src/lib/adminAuth.ts`
4. Use the pattern: `getBearerToken(req)` → `supabaseServer.auth.getUser(token)` → `getManagerStoreIds(user.id)`
   NOTE: `getManagerStoreIds` takes userId: string, NOT a Request object.
5. Replace the inline `store_managers` query with this pattern
5. Use the returned array in place of the manually queried store IDs

DO NOT: Change any business logic. Only change how the manager's storeIds are obtained.
The result (an array of store UUIDs) should be identical — just sourced from the helper.
Verify: `npx tsc --noEmit` after changes.

Prompt for Step 4 — Fix health endpoint
TASK: Remove environment variable exposure from the health endpoint.

CONTEXT: `src/app/api/health/route.ts` is publicly accessible with no authentication
and currently returns fields like `hasServiceRole` and `nodeEnv` that expose
server environment configuration.

FIX:
1. Read the file: `src/app/api/health/route.ts`
2. Modify the GET handler to return ONLY: `{ ok: true }` (or `{ ok: true, ts: Date.now() }`)
3. Remove all environment variable checks and any other diagnostic fields from the response

DO NOT: Add authentication. Do not remove the route. Just strip the response to minimal info.
Verify: `npx tsc --noEmit` after changes.

Prompt for Step 5 — Fix safe-ledger input validation
TASK: Fix input validation gaps in two safe-ledger admin routes.

FILES TO MODIFY:
1. `src/app/api/admin/safe-ledger/route.ts`
2. `src/app/api/admin/safe-ledger/[id]/route.ts`

FIX for file 1 (route.ts POST handler):
- Read the file first
- Find the POST handler
- Locate where `body.store_id` and `body.profile_id` are used with non-null assertions (`!`)
- BEFORE the store membership check, add explicit null guards:
  if (!body.store_id || !body.profile_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
- Remove the non-null assertions (`!`) after these checks

FIX for file 2 ([id]/route.ts PATCH handler):
- Read the file first
- Find the line: `const body = await req.json().catch(() => ({}))`
- Replace with:
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

DO NOT: Change any other logic.
Verify: `npx tsc --noEmit` after changes.

Prompt for Step 6 — Fix payroll advances null store_id
TASK: Improve error handling for null store_id in payroll advances route.

FILE: `src/app/api/admin/payroll/advances/[id]/route.ts`

FIX:
1. Read the file
2. Find the `validateAccess()` helper function (or inline check) that examines `data.store_id`
3. Add an explicit branch for the case where `data.store_id` is null:
   if (data.store_id === null || data.store_id === undefined) {
     console.error('[payroll/advances] advance has null store_id, id:', data.id)
     return NextResponse.json({ error: 'Internal error: advance missing store association' }, { status: 500 })
   }
4. This branch should come BEFORE the authorization check (which should remain as-is)

DO NOT: Change the authorization logic. Only add the null guard before it.
Verify: `npx tsc --noEmit` after changes.

### Prompt for Step 7a — RLS Migration: payroll_advances
```
TASK: Write a production-safe, idempotent SQL migration enabling RLS on payroll_advances.
No staging environment — this goes straight to production. Be conservative.

CONTEXT:
- Forward-only migration. File: `src/app/sql/60_rls_payroll_advances.sql`
- Supabase Postgres. Service role bypasses RLS. Authenticated role uses RLS.
- Manager auth: Supabase Auth → auth.uid() is the manager's user_id
- Employee auth: custom ES256 JWT — auth.uid() is NOT set for employees. Employees
  access this table via service-role RPCs only, so no employee RLS policy is needed.
- Manager scope: store_id IN (SELECT store_id FROM store_managers WHERE user_id = auth.uid())
- Reference existing policy patterns in: `src/app/sql/11_rls.sql`

PHASE 0 — PREFLIGHT (run these SELECT queries first, do not write migration until confirmed):
  SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relname = 'payroll_advances';

  SELECT tablename, policyname, cmd, roles
  FROM pg_policies WHERE tablename = 'payroll_advances';

  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'payroll_advances'
  ORDER BY ordinal_position;

Read `src/app/sql/` — glob for the migration that creates payroll_advances to confirm
exact column names (especially the store_id FK column name).

PHASE 1 — WRITE MIGRATION (only after preflight confirms names):
- Use idempotent patterns:
  ALTER TABLE payroll_advances ENABLE ROW LEVEL SECURITY;  -- safe to re-run
  DROP POLICY IF EXISTS <name> ON payroll_advances;        -- before every CREATE POLICY
  CREATE POLICY <name> ON payroll_advances ...;

- Policies to add:
  - Manager SELECT: store_id IN (SELECT store_id FROM store_managers WHERE user_id = auth.uid())
  - Manager INSERT: same scope
  - Manager UPDATE: same scope
  - No employee SELECT policy (employees use service-role RPCs for this table)

DO NOT: Modify any existing migration files. Do not add employee policies unless
you confirm employees directly query this table (they don't — check API routes first).
Verify SQL syntax before finalizing.
```

---

### Prompt for Step 7b — RLS Migration: safe_pickups
```
TASK: Write a production-safe, idempotent SQL migration enabling RLS on safe_pickups.

CONTEXT: Same as Step 7a. File: `src/app/sql/61_rls_safe_pickups.sql`

PHASE 0 — PREFLIGHT:
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'safe_pickups';
  SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'safe_pickups';
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'safe_pickups' ORDER BY ordinal_position;

Also read: `src/app/api/admin/safe-ledger/pickups/route.ts` to confirm which columns
are used (especially the "recorded by" column name).

PHASE 1 — POLICIES:
- Manager SELECT/INSERT: store_id in manager scope
- Employee SELECT: recorded_by = JWT profile claim
  (use same JWT claim pattern as safe_closeouts_employee_select_own in 47_safe_ledger_closeout.sql)

Use DROP POLICY IF EXISTS before every CREATE POLICY. Use idempotent ALTER TABLE.
```

---

### Prompt for Step 7c — RLS Migration: daily_sales_records
```
TASK: Write a production-safe, idempotent SQL migration enabling RLS on daily_sales_records.

CONTEXT: Same as Step 7a. File: `src/app/sql/62_rls_daily_sales_records.sql`

PHASE 0 — PREFLIGHT:
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'daily_sales_records';
  SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'daily_sales_records';
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'daily_sales_records' ORDER BY ordinal_position;

PHASE 1 — POLICIES:
- Manager SELECT: store_id in manager scope
- No employee policy (employees submit via RPCs that use service role)

Use DROP POLICY IF EXISTS before every CREATE POLICY.
```

---

### Prompt for Step 7d — RLS Migration: shift_sales_counts
```
TASK: Write a production-safe, idempotent SQL migration enabling RLS on shift_sales_counts.

CONTEXT: Same as Step 7a. File: `src/app/sql/63_rls_shift_sales_counts.sql`

PHASE 0 — PREFLIGHT:
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'shift_sales_counts';
  SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'shift_sales_counts';
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shift_sales_counts' ORDER BY ordinal_position;

Confirm the FK column linking to shifts (likely shift_id). Check `src/app/sql/45_*.sql`
or similar for the table definition.

PHASE 1 — POLICIES:
- Manager SELECT: via shift_id → shifts.store_id in manager scope
  Example: store_id = (SELECT store_id FROM shifts WHERE id = shift_sales_counts.shift_id)
  AND store_id IN (SELECT store_id FROM store_managers WHERE user_id = auth.uid())
- No employee policy (service-role RPCs only)

Use DROP POLICY IF EXISTS before every CREATE POLICY.
```

---

### Prompt for Step 8a — RLS Migration: cleaning_task_completions
```
TASK: Write a production-safe, idempotent SQL migration enabling RLS on cleaning_task_completions.

CONTEXT: Same production-safe approach. File: `src/app/sql/64_rls_cleaning_task_completions.sql`

IMPORTANT: The cleaning RPCs (`fetch_cleaning_tasks_for_shift`, `complete_cleaning_task`,
`skip_cleaning_task`) use SECURITY DEFINER with `set row_security = off`. They bypass RLS.
Adding RLS here does NOT break those RPCs — it only adds defense for any non-RPC access.

PHASE 0 — PREFLIGHT:
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'cleaning_task_completions';
  SELECT tablename, policyname FROM pg_policies WHERE tablename = 'cleaning_task_completions';
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'cleaning_task_completions' ORDER BY ordinal_position;

Read `src/app/sql/41_cleaning_tasks.sql` to confirm schema.

PHASE 1 — POLICIES:
- Employee SELECT/INSERT: shift_id → shifts.profile_id = JWT profile claim
- Manager SELECT: shift_id → shifts.store_id in manager scope

Use DROP POLICY IF EXISTS + idempotent ALTER TABLE.
```

---

### Prompt for Step 8b — RLS Migration: store_cleaning_schedules
```
TASK: Write a production-safe, idempotent SQL migration enabling RLS on store_cleaning_schedules.

File: `src/app/sql/65_rls_store_cleaning_schedules.sql`

PHASE 0 — PREFLIGHT:
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'store_cleaning_schedules';
  SELECT tablename, policyname FROM pg_policies WHERE tablename = 'store_cleaning_schedules';
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'store_cleaning_schedules' ORDER BY ordinal_position;

PHASE 1 — POLICIES:
- Manager ALL: store_id in manager scope
- Employee SELECT: store_id in JWT store_ids claim (same pattern as schedule employee read in 21_schedule_rls.sql)

Use DROP POLICY IF EXISTS + idempotent ALTER TABLE.
```

---

### Prompt for Step 8c — RLS Migration: shift_checklist_checks
```
TASK: Write a production-safe, idempotent SQL migration enabling RLS on shift_checklist_checks.

File: `src/app/sql/66_rls_shift_checklist_checks.sql`

PHASE 0 — PREFLIGHT:
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'shift_checklist_checks';
  SELECT tablename, policyname FROM pg_policies WHERE tablename = 'shift_checklist_checks';
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shift_checklist_checks' ORDER BY ordinal_position;

PHASE 1 — POLICIES:
- Employee SELECT/INSERT/UPDATE: shift_id → shifts.profile_id = JWT profile claim
- Manager SELECT: shift_id → shifts.store_id in manager scope

Use DROP POLICY IF EXISTS + idempotent ALTER TABLE.
```

---

### Prompt for Step 8d — RLS Migration: shift_change_audit_logs
```
TASK: Write a production-safe, idempotent SQL migration enabling RLS on shift_change_audit_logs.

File: `src/app/sql/67_rls_shift_change_audit_logs.sql`

PHASE 0 — PREFLIGHT:
  SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'shift_change_audit_logs';
  SELECT tablename, policyname FROM pg_policies WHERE tablename = 'shift_change_audit_logs';
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shift_change_audit_logs' ORDER BY ordinal_position;

Read `src/app/sql/56_shift_change_audit_log.sql` to confirm schema (especially store_id column).

PHASE 1 — POLICIES:
- Manager SELECT only: store_id in manager scope
- No employee policy (audit logs are manager-only)

Use DROP POLICY IF EXISTS + idempotent ALTER TABLE.
Additional Security Notes
A — Employee JWT claims are not DB-verified
authenticateShiftRequest() trusts the profile_id and store_ids claims from the ES256 JWT without cross-checking against the database. If a JWT is issued with incorrect claims (due to a bug in the signing path), the error will propagate silently. Recommendation (future hardening): Add a lightweight DB lookup on the first employee request per session to confirm the profile still exists and still belongs to the claimed stores. Cache the result per request to avoid N+1.
B — 16_clock_windows.sql has an older clock_window_check() without search_path
Migration 42_security_and_timezone_fixes.sql re-creates clock_window_check() with search_path. Verify that the Supabase migration system applies them in order and that the function in the DB actually has search_path set. Run: SELECT prosrc FROM pg_proc WHERE proname = 'clock_window_check' and confirm SET search_path is present.
C — profiles_select_clock_in is broader than necessary
The policy allows anon to SELECT all columns from profiles to support the clock-in UX. Consider a column-restricted view or a SECURITY DEFINER RPC that only returns {id, display_name} for clock-in lookups. This limits the blast radius if the policy is ever misconfigured.
D — No rate limiting on any endpoint
The codebase has no request rate limiting at the API layer. High-volume endpoints (start-shift, end-shift, closeout submit) could be abused. Consider Vercel Edge Middleware for IP-based rate limiting on PIN-authenticated routes.
E — Cron routes use only CRON_SECRET header (no IP allowlist)
Both cron routes check Authorization: Bearer CRON_SECRET. This is correct but relies entirely on the secret not leaking. Consider also verifying that the request comes from Vercel's cron infrastructure (Vercel sets x-vercel-cron header on cron invocations). Add: if (!req.headers.get('x-vercel-cron')) return 401 as a secondary check.
F — supabaseServer import used in some employee routes
Several employee-facing routes import supabaseServer (service role) for certain queries. This is acceptable when done intentionally (RPCs, seed lookups), but should be audited to ensure no employee route uses service role for user-controlled data reads without explicit filtering. The pattern is correct in current code but worth flagging for code review on any new employee routes.

Verification
For each step:

npx tsc --noEmit — no TypeScript errors
npm run build — clean build
Manual test: log in as Manager A (Store 1 only), attempt to access Store 2 data via affected endpoints — should get 403
For SQL migrations (production-first): run preflight SELECTs first, deploy one migration at a time, then verify policies with SELECT * FROM pg_policies WHERE tablename = '<table>' plus immediate manager/employee smoke tests.
For health endpoint: curl https://[your-domain]/api/health — should only return { ok: true }

Build Order
1 → open-shifts routes (CRITICAL) | 2 → variances review (CRITICAL) | 3 → schedules auth refactor (HIGH) | 4 → health endpoint (HIGH) | 5 → safe-ledger validation (MEDIUM) | 6 → advances null check (MEDIUM) | 7 → financial tables RLS migration (CRITICAL) | 8 → operational tables RLS migration (MEDIUM) | 9 → profiles clock-in policy review (LOW, optional)
Implementation Tracker
- [x] Step 1 - Fix open-shifts routes
- [x] Step 2 - Fix variances review route
- [x] Step 3 - Refactor schedules route auth helper usage
- [x] Step 4 - Harden health endpoint response
- [x] Step 5 - Fix safe-ledger input validation
- [x] Step 6 - Add payroll advances null store guard
- [x] Step 7 - Add financial tables RLS migration
- [x] Step 8 - Add operational tables RLS migration
- [x] Step 9 - Review/restrict profiles clock-in policy (optional)


### Step 7/8 Prompt Guardrails (Apply To All Remaining RLS Prompts)
- Use exact schema names confirmed in preflight. For `safe_pickups`, the employee ownership column is `recorded_by` (not `recorded_by_profile_id`).
- For any INSERT/UPDATE policy, always define both `USING (...)` and `WITH CHECK (...)`.
- For shift-linked table scope checks (`shift_sales_counts`, `cleaning_task_completions`, `shift_checklist_checks`), prefer `EXISTS (SELECT 1 FROM shifts ...)` ownership checks over scalar subqueries.
- Keep employee policies minimal and only where direct employee DB access is confirmed; prefer manager-scope policies first.
- Add rollback posture to every migration prompt: if policy blocks valid prod traffic, ship an immediate forward migration that drops/recreates only the affected policies.
- Production-only verification sequence: preflight -> apply one migration -> verify `pg_policies` -> smoke test manager and employee paths.
