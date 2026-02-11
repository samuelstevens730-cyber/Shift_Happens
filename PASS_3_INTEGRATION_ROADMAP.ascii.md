# Pass 3: Integration & Execution Roadmap

> **Generated:** 2026-02-10 | **Role:** Technical Program Manager / Staff Engineer
> **Inputs:** AUDIT_PHASE_1_FINDINGS.md (16 findings), AUDIT_PHASE_2_FRONTEND.md (22 findings), REFACTOR_PLAN_CLOCK_CLIENT.md (10 steps)
> **Estimated Total Effort:** 28-36 hours across 6 phases, 21 steps

---

## Pre-Flight Checklist

Before executing **any** step:

- [ ] `git checkout -b pass3/phase-N-step-M` (fresh branch per step)
- [ ] `npx tsc --noEmit` passes (baseline)
- [ ] `npm run build` passes (baseline)
- [ ] Read `AGENTS.md` constraints (especially lines 35, 38, 43)
- [ ] Confirm SQL migration numbering: next available = **42** (after `41_cleaning_rpc.sql`)
- [ ] Confirm test runner: `node --test --import tsx` (no Jest/Vitest)

---

## Dependency Graph (Simplified)

```
Phase 1: Data Integrity & Security (Backend-Only)
  1.1 
  1.2   (all independent of each other)
  1.3 
  1.4 
  1.5 
  1.6 

Phase 2: Frontend Safety Net
  2.1  (no backend dependency)
  2.2  (no backend dependency)
  2.3  depends on 2.2 (FE-06 fix baked into extracted helpers)

Phase 3: Frontend Decomposition
  3.1  depends on 2.3 (imports clockHelpers)
  3.2  depends on 2.1 (error boundaries as safety net)
  3.3  depends on 2.1
  3.4  depends on 2.1 (highest-risk modal extraction)
  3.5  depends on 3.4 (PinGate swap after stale-shift extracted)

Phase 4: API Contract Stabilization
  4.1  depends on 1.2 (atomic RPC referenced)
  4.2  independent
  4.3  independent
  4.4  independent

Phase 5: Frontend Integration
  5.1  depends on 1.2 (calls atomic shift RPC via API), 3.1-3.5 (components exist)
  5.2  depends on 5.1 + all Phase 3 (HIGHEST RISK  full reducer rewrite)
  5.3  depends on 3.5 (modifies PinGate)
  5.4  depends on 2.1 (layout.tsx changes)

Phase 6: Hardening
  6.1  independent
  6.2  depends on 5.3 (client expiry tracking must exist first)
  6.3  independent
```

---

## Phase 1: Data Integrity & Security (Backend-Only)

> **Goal:** Fix all CRITICAL/HIGH backend findings before touching frontend.
> **Rationale:** Backend changes may alter API response shapes, RPC signatures, or error codes. Frontend must build against stable contracts.
> **Estimated Time:** 4-5 hours

---

### Step 1.1  SQL: Security & Timezone Fixes

| Field | Value |
|-------|-------|
| **Priority** | CRITICAL |
| **Findings** | F-06 (search_path), F-07 (timezone casts) |
| **Dependencies** | None |
| **Files** | CREATE `src/app/sql/42_security_and_timezone_fixes.sql` |
| **References** | `40_clock_window_schedule_fallback.sql:5-13`, `27_validation_functions.sql:24-25,45,48,119-120,141,144` |

**Context:** `clock_window_check()` is `SECURITY DEFINER` but missing `SET search_path = public` (F-06). Two validation functions cast `(date + time)::timestamptz` without specifying timezone, using Postgres session TZ (UTC) instead of America/Chicago (F-07). These affect shift conflict detection near midnight CST.

**Deliverables:**
1. `42_security_and_timezone_fixes.sql` with:
   - `CREATE OR REPLACE FUNCTION clock_window_check(...)` adding `SET search_path = public`
   - `CREATE OR REPLACE FUNCTION check_bilocation_conflict(...)` replacing all `(p_shift_date + p_scheduled_start)::timestamptz` with `(p_shift_date + p_scheduled_start) AT TIME ZONE 'America/Chicago'`
   - `CREATE OR REPLACE FUNCTION check_solo_coverage_conflict(...)` with same timezone fix
2. Preserve all existing function logic  ONLY add `SET search_path` and fix timezone casts

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Run the SQL against a staging Supabase instance
# Verify: SELECT clock_window_check(...) returns same results as before for standard cases
# Verify: check_bilocation_conflict returns correct results for shifts at 11:30 PM CST
```

**Rollback:** `DROP FUNCTION` + recreate from original `40_*.sql` and `27_*.sql` definitions.

<details>
<summary><strong>AGENT PROMPT  Step 1.1</strong></summary>

```
PERSONA: Codex (SQL / PostgreSQL)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Read src/AGENTS.md first. Key rules: Line 35 (RPCs for complex mutations), Line 37 (security definer convention), Line 38 (forward-only migrations).

TASK: Create SQL migration 42  Security & Timezone Fixes

CONTEXT:
- Audit finding F-06: `clock_window_check()` in `src/app/sql/40_clock_window_schedule_fallback.sql` (lines 5-13) is SECURITY DEFINER but missing `SET search_path = public`.
- Audit finding F-07: `check_bilocation_conflict()` and `check_solo_coverage_conflict()` in `src/app/sql/27_validation_functions.sql` cast `(p_shift_date + p_scheduled_start)::timestamptz` WITHOUT specifying timezone (lines 24-25, 45, 48, 119-120, 141, 144). This uses PostgreSQL session TZ (UTC on Supabase) instead of America/Chicago.

INSTRUCTIONS:
1. Read `src/app/sql/40_clock_window_schedule_fallback.sql` completely.
2. Read `src/app/sql/27_validation_functions.sql` completely.
3. Create `src/app/sql/42_security_and_timezone_fixes.sql` containing:
   a. `CREATE OR REPLACE FUNCTION clock_window_check(...)`  copy the ENTIRE existing function but ADD `SET search_path = public` to the function definition (after SECURITY DEFINER).
   b. `CREATE OR REPLACE FUNCTION check_bilocation_conflict(...)`  copy the ENTIRE existing function but REPLACE every instance of `(p_shift_date + p_scheduled_start)::timestamptz` and `(p_shift_date + p_scheduled_end)::timestamptz` with `(p_shift_date + p_scheduled_start) AT TIME ZONE 'America/Chicago'` and `(p_shift_date + p_scheduled_end) AT TIME ZONE 'America/Chicago'` respectively.
   c. `CREATE OR REPLACE FUNCTION check_solo_coverage_conflict(...)`  same timezone fix as (b).
4. Add a header comment explaining what this migration fixes.
5. Do NOT change any logic  only add search_path and fix timezone casts.

CONSTRAINTS:
- Follow existing convention: SECURITY DEFINER SET search_path = public
- Do not rename functions or change parameter signatures
- This is a forward-only migration (AGENTS.md line 38)

VERIFICATION:
- npx tsc --noEmit (should be unaffected  this is SQL only)
- npm run build (should be unaffected)
- Visually verify the SQL is syntactically correct
```

</details>

---

### Step 1.2  SQL + API: Atomic Shift+Drawer Creation RPC

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | F-10 (non-atomic shift creation) |
| **Dependencies** | None |
| **Files** | CREATE `src/app/sql/43_atomic_shift_creation.sql`, MODIFY `src/app/api/start-shift/route.ts` |
| **References** | `start-shift/route.ts:325-387` (two-step insert + manual rollback at L384) |

**Context:** Currently, `start-shift` creates a shift row (L325-343), then inserts a drawer count (L372-387). If the drawer insert fails, the API manually DELETEs the shift (L384). If the DELETE also fails (network/timeout), an orphaned shift exists blocking future clock-ins. AGENTS.md line 35 mandates RPCs for complex mutations.

**Deliverables:**
1. `43_atomic_shift_creation.sql`  New RPC `create_shift_with_drawer()`:
   - Parameters: `p_store_id uuid, p_profile_id uuid, p_shift_type shift_type, p_started_at timestamptz, p_planned_start_at timestamptz, p_schedule_shift_id uuid DEFAULT NULL, p_note text DEFAULT NULL, p_drawer_amount_cents integer DEFAULT NULL, p_change_drawer_cents integer DEFAULT NULL, p_expected_drawer_cents integer DEFAULT NULL`
   - Returns: `uuid` (the new shift ID)
   - Body: Single transaction  INSERT shift, INSERT `shift_drawer_counts` (type='start'), return shift.id
   - On `unique_violation` (23505): raise custom exception with shift ID for 409 handling
   - `SECURITY DEFINER SET search_path = public`
2. Modified `start-shift/route.ts`:
   - Replace the two-step insert block (L325-387) with a single `.rpc('create_shift_with_drawer', {...})` call
   - Remove the manual DELETE rollback code
   - Preserve all existing validation logic BEFORE the insert (auth, schedule matching, clock window checks, etc.)
   - Handle the 23505 exception from the RPC the same way (409 response with shiftId)

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual test: Clock in with valid drawer  verify shift + drawer_count both created
# Manual test: Clock in with duplicate  verify 409 returned with shiftId
# Manual test: Verify no orphaned shifts in DB after failed attempts
```

**Rollback:** Revert `start-shift/route.ts` to previous version. The SQL RPC can remain (unused) or be dropped.

<details>
<summary><strong>AGENT PROMPT  Step 1.2</strong></summary>

```
PERSONA: Codex (SQL + TypeScript API Routes)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Read src/AGENTS.md first. Key rules: Line 35 (ALWAYS use RPCs for complex mutations), Line 38 (forward-only migrations), Lines 47-48 (start-shift is high-risk).

TASK: Create atomic shift+drawer creation RPC and update start-shift API route

CONTEXT:
- Audit finding F-10: `src/app/api/start-shift/route.ts` lines 325-387 creates a shift, then inserts a drawer count in TWO separate Supabase calls. If the drawer insert fails, the API manually DELETEs the shift at line 384. If the DELETE fails too, an orphaned shift is left in the database.
- AGENTS.md line 35 requires RPCs for complex mutations.

INSTRUCTIONS:
1. Read `src/app/api/start-shift/route.ts` completely. Pay special attention to:
   - Lines 325-343 (shift INSERT)
   - Lines 345-370 (conflict handling, 23505 unique violation  409)
   - Lines 372-387 (drawer count INSERT + manual DELETE rollback)
   - The exact column names and values used in both INSERTs
2. Read `src/app/sql/01_schema.sql` to understand the `shifts` and `shift_drawer_counts` table schemas.

3. Create `src/app/sql/43_atomic_shift_creation.sql`:
   - Define `create_shift_with_drawer(...)` that:
     a. INSERTs into `shifts` (same columns as route.ts L325-343)
     b. INSERTs into `shift_drawer_counts` with count_type='start' (same columns as route.ts L372-387)
     c. Returns the new shift ID (uuid)
     d. Handles unique_violation (23505) by raising an exception that includes the conflicting shift ID  format: RAISE EXCEPTION 'CONFLICT::%', existing_shift_id
   - Use SECURITY DEFINER SET search_path = public
   - Make drawer params optional (some shift types don't require drawers  shift_type='other')

4. Modify `src/app/api/start-shift/route.ts`:
   - Replace the two-step insert block (approximately L325-387) with a single `supabaseServer.rpc('create_shift_with_drawer', {...})` call
   - Parse the CONFLICT:: exception to extract the existing shift ID for 409 responses
   - REMOVE the manual DELETE rollback code entirely (no longer needed  RPC is atomic)
   - Do NOT modify any code BEFORE the insert block (all auth, validation, schedule matching must remain unchanged)
   - Do NOT modify any code AFTER the insert block (response construction, etc.)

CONSTRAINTS:
- The RPC parameter names must use p_ prefix (Postgres convention in this codebase)
- The 409 response shape must remain { error: string, shiftId: string } for frontend compatibility
- Keep all existing validation and auth checks in the API route untouched
- High-risk file  be surgical, change only the insert block

VERIFICATION:
- npx tsc --noEmit
- npm run build
- Verify the RPC SQL is syntactically valid
- Verify the route still returns the same response shapes for all cases (success, 409, 500)
```

</details>

---

### Step 1.3  SQL + Edge Function: O(n) PIN Auth Fix

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | F-04 (O(n) fallback scan) |
| **Dependencies** | None |
| **Files** | CREATE `src/app/sql/44_employee_code_index.sql`, MODIFY `supabase/functions/employee-auth/index.ts` |
| **References** | `employee-auth/index.ts:158-192` (primary lookup L158-174, fallback scan L176-192) |

**Context:** The employee-auth edge function first tries an `.ilike()` query for employee_code (L158-174). If that misses (e.g., formatting differences), it falls back to loading ALL active profiles with employee codes into memory and iterating in JavaScript (L176-192). This is O(n) per auth attempt and loads all PIN hashes into edge function memory.

**Deliverables:**
1. `44_employee_code_index.sql`:
   - `CREATE INDEX idx_profiles_employee_code_norm ON profiles(UPPER(REPLACE(employee_code, '-', ''))) WHERE active = true AND employee_code IS NOT NULL;`
2. Modified `employee-auth/index.ts`:
   - Replace the JS fallback loop (L176-192) with an indexed query: `.eq('employee_code_normalized', normalizedInput)` or equivalent RPC
   - If using a generated column approach, add `employee_code_normalized` as a generated column in the migration
   - Alternative: use a raw SQL query via `.rpc()` that leverages the functional index
   - Remove the code that loads all profiles into memory

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Test PIN auth with codes in different formats (e.g., "LV1-A7K" vs "LV1A7K" vs "lv1-a7k")
# Manual: Verify EXPLAIN ANALYZE on the query uses the index
```

**Rollback:** Drop the index. Revert edge function to previous version with fallback scan.

<details>
<summary><strong>AGENT PROMPT  Step 1.3</strong></summary>

```
PERSONA: Codex (SQL + Deno Edge Functions)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Read src/AGENTS.md first. Key rules: Line 29-32 (employee PIN auth flow), Line 38 (forward-only migrations).

TASK: Fix O(n) employee code lookup in PIN authentication

CONTEXT:
- Audit finding F-04: `supabase/functions/employee-auth/index.ts` lines 176-192 contain a fallback that loads ALL active profiles with employee_code IS NOT NULL into edge function memory, then iterates in JavaScript to find a match. This is O(n) per auth attempt.
- The primary lookup (lines 158-174) uses `.or()` with `.ilike()` but can miss due to format differences (dashes, casing).

INSTRUCTIONS:
1. Read `supabase/functions/employee-auth/index.ts` completely.
2. Read `src/app/sql/01_schema.sql` to understand the `profiles` table schema.

3. Create `src/app/sql/44_employee_code_index.sql`:
   - Add a functional index on normalized employee_code: `CREATE INDEX idx_profiles_employee_code_norm ON profiles(UPPER(REPLACE(employee_code, '-', ''))) WHERE active = true AND employee_code IS NOT NULL;`
   - Optionally add a generated column `employee_code_normalized` for easier querying: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_code_normalized text GENERATED ALWAYS AS (UPPER(REPLACE(employee_code, '-', ''))) STORED;`
   - If adding the generated column, also create a standard index on it.

4. Modify `supabase/functions/employee-auth/index.ts`:
   - Replace the fallback scan block (approximately lines 176-192) with an indexed query
   - The query should normalize the input the same way (UPPER + remove dashes) and match against the index
   - Use Supabase client query or raw SQL via .rpc()  whichever is simpler
   - Keep the primary `.ilike()` lookup as the FIRST attempt (it handles the common case)
   - The fallback should be a QUERY (using the index), not a JS loop
   - Preserve the PBKDF2 verification logic that follows the lookup (lines 194+)

CONSTRAINTS:
- Do NOT change the PBKDF2 parameters (150,000 iterations, SHA-256, 32 bytes)
- Do NOT change the JWT signing logic
- Do NOT change the lockout logic
- Edge function uses Deno runtime  verify import compatibility

VERIFICATION:
- npx tsc --noEmit (may not cover edge function  that's OK)
- npm run build
- Verify the SQL migration is syntactically correct
- Verify the edge function compiles (no Deno syntax errors)
```

</details>

---

### Step 1.4  API Route: Message Dismiss Store Validation

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | F-01 (missing store validation) |
| **Dependencies** | None |
| **Files** | MODIFY `src/app/api/messages/[id]/dismiss/route.ts` |
| **References** | Route currently checks `target_profile_id === auth.profileId` but no store cross-check |

**Context:** The dismiss endpoint only validates that the message's `target_profile_id` matches the authenticated employee. It does NOT verify that the message belongs to the employee's current store context. An employee authenticated for Store A could dismiss messages intended for Store B if they somehow obtain the message ID.

**Deliverables:**
1. Modified `dismiss/route.ts`:
   - After the existing `target_profile_id` check, add a store validation check
   - Query the message's `delivered_store_id` (or equivalent store FK) and verify it matches the authenticated user's `store_id` from the JWT claims
   - Return 403 with `{ error: "Store mismatch" }` if validation fails

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Dismiss a message from the correct store  should succeed
# Manual: Attempt to dismiss a message from a different store  should get 403
```

**Rollback:** Revert the single file to its previous version.

<details>
<summary><strong>AGENT PROMPT  Step 1.4</strong></summary>

```
PERSONA: Codex (TypeScript API Routes)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Read src/AGENTS.md first. Key rules: Line 32 (authenticateShiftRequest for employee routes), Line 56 (explicit error responses).

TASK: Add store validation to message dismiss endpoint

CONTEXT:
- Audit finding F-01: `src/app/api/messages/[id]/dismiss/route.ts` only checks `target_profile_id === auth.profileId`. No verification that the message belongs to the user's current store context.
- The auth system provides store_id(s) in the JWT claims via `authenticateShiftRequest()`.

INSTRUCTIONS:
1. Read `src/app/api/messages/[id]/dismiss/route.ts` completely.
2. Read `src/lib/shiftAuth.ts` to understand what `authenticateShiftRequest()` returns (specifically: does it return store_id or store_ids[X]).
3. Identify the message table's store FK column (likely `store_id` or `delivered_store_id`).

4. Modify the dismiss route to:
   a. After the existing profile_id check passes, fetch or verify the message's store_id
   b. Check that the message's store_id is in the authenticated user's store_ids array (from JWT claims)
   c. If not, return: `NextResponse.json({ error: "Store mismatch" }, { status: 403 })`

CONSTRAINTS:
- Do NOT change the existing auth flow or profile_id check
- Use the same Supabase client pattern as the rest of the route
- Keep the response format consistent: { error: string }

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 1.5  SQL: Timesheet Payroll Lock Re-Check

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | F-08 (approve bypasses payroll lock) |
| **Dependencies** | None |
| **Files** | CREATE `src/app/sql/45_timesheet_payroll_recheck.sql` |
| **References** | `30_timesheet_rpc.sql:89-184` (`approve_timesheet_change_request()` function) |

**Context:** `approve_timesheet_change_request()` validates that original shift times haven't changed since the request was submitted (staleness check), but does NOT re-check `check_payroll_lock()`. A timesheet change request submitted before the payroll lock, pending through the lock boundary, can be approved after the lock  modifying a locked pay period.

**Deliverables:**
1. `45_timesheet_payroll_recheck.sql`:
   - `CREATE OR REPLACE FUNCTION approve_timesheet_change_request(...)` with an added payroll lock check
   - Insert the check BEFORE applying changes (before the UPDATE statement): `SELECT * INTO v_lock FROM check_payroll_lock(v_shift.started_at); IF v_lock.is_locked THEN RAISE EXCEPTION 'Payroll period is locked. Cannot approve changes to shifts in a locked period.';`
   - Preserve ALL existing logic  only ADD the lock check

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Submit a timesheet change, lock the payroll period, then attempt to approve  should fail
```

**Rollback:** Recreate the function from `30_timesheet_rpc.sql` original definition.

<details>
<summary><strong>AGENT PROMPT  Step 1.5</strong></summary>

```
PERSONA: Codex (SQL / PostgreSQL)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Read src/AGENTS.md first. Line 38: forward-only migrations.

TASK: Add payroll lock re-check to approve_timesheet_change_request()

CONTEXT:
- Audit finding F-08: `approve_timesheet_change_request()` in `src/app/sql/30_timesheet_rpc.sql` (lines 89-184) does NOT re-check `check_payroll_lock()` at approval time. A request submitted before a lock can be approved after the lock.
- The function `check_payroll_lock()` already exists in the codebase.

INSTRUCTIONS:
1. Read `src/app/sql/30_timesheet_rpc.sql` completely  focus on `approve_timesheet_change_request()`.
2. Find where `check_payroll_lock()` is defined (search for it in the sql directory).
3. Understand the return type of `check_payroll_lock()` (likely returns a record with `is_locked` boolean).

4. Create `src/app/sql/45_timesheet_payroll_recheck.sql`:
   - CREATE OR REPLACE the `approve_timesheet_change_request()` function
   - Copy the ENTIRE existing function body
   - ADD a payroll lock check BEFORE the UPDATE/modification statements
   - The check should call `check_payroll_lock(v_shift.started_at)` and RAISE EXCEPTION if locked
   - Use the same SECURITY DEFINER SET search_path = public convention

CONSTRAINTS:
- Do NOT change any existing logic in the function
- Only ADD the payroll lock check
- The exception message should be user-friendly: "Payroll period is locked"
- Follow the existing error handling pattern in the function

VERIFICATION:
- Visually verify the SQL is syntactically correct
- npx tsc --noEmit (unaffected  SQL only)
- npm run build (unaffected)
```

</details>

---

### Step 1.6  SQL: Swap Request Partial Unique Index

| Field | Value |
|-------|-------|
| **Priority** | LOW |
| **Findings** | F-12 (race condition on swap submit) |
| **Dependencies** | None |
| **Files** | CREATE `src/app/sql/46_swap_request_unique_index.sql` |
| **References** | `28_swap_rpc.sql:32-39` (soft guard SELECT EXISTS) |

**Context:** Active swap request uniqueness is enforced by a `SELECT EXISTS` soft guard in `submit_shift_swap_request()`. Under concurrent requests, two calls for the same `schedule_shift_id` could both pass the check before either inserts, creating duplicate active requests.

**Deliverables:**
1. `46_swap_request_unique_index.sql`:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_requests_active
   ON shift_swap_requests(schedule_shift_id)
   WHERE status IN ('open', 'pending');
   ```

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Verify existing data doesn't violate the constraint before applying
# Run: SELECT schedule_shift_id, count(*) FROM shift_swap_requests WHERE status IN ('open','pending') GROUP BY 1 HAVING count(*) > 1;
```

**Rollback:** `DROP INDEX IF EXISTS idx_swap_requests_active;`

<details>
<summary><strong>AGENT PROMPT  Step 1.6</strong></summary>

```
PERSONA: Codex (SQL)
PROJECT: Shift Happens  Workforce Management App

TASK: Add partial unique index for active swap requests

CONTEXT:
- Finding F-12: `submit_shift_swap_request()` uses a soft SELECT EXISTS guard (src/app/sql/28_swap_rpc.sql lines 32-39). Concurrent requests can bypass this.

INSTRUCTIONS:
1. Create `src/app/sql/46_swap_request_unique_index.sql` containing:
   - A partial unique index: CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_requests_active ON shift_swap_requests(schedule_shift_id) WHERE status IN ('open', 'pending');
   - A header comment explaining this prevents concurrent duplicate swap requests
2. Add a safety query comment showing how to check for existing violations before applying.

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

## Phase 2: Frontend Safety Net

> **Goal:** Establish error boundaries and fix the CST rounding bug BEFORE any component extraction.
> **Rationale:** Error boundaries catch regressions from Phase 3 extractions. The FE-06 rounding fix must be baked into `clockHelpers.ts` before extraction.
> **Estimated Time:** 2-3 hours

---

### Step 2.1  Global Error Boundaries

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | FE-08 (no error boundary) |
| **Dependencies** | None |
| **Files** | CREATE `src/app/error.tsx`, `src/app/clock/error.tsx`, `src/app/admin/error.tsx`, `src/app/run/error.tsx` |
| **References** | `src/app/layout.tsx:1-38` (no ErrorBoundary present) |

**Context:** There is no `ErrorBoundary` anywhere in the app. An unhandled exception in any component crashes the entire React tree with a white screen. Next.js App Router `error.tsx` convention provides automatic error boundaries per route segment.

**Deliverables:**
1. Four `error.tsx` files (must be `"use client"` components):
   - `src/app/error.tsx`  root-level catch-all
   - `src/app/clock/error.tsx`  clock page specific (shows "Return to Home" + "Try Again")
   - `src/app/admin/error.tsx`  admin section specific
   - `src/app/run/error.tsx`  run section specific
2. Each error component should:
   - Accept `{ error, reset }` props (Next.js convention)
   - Display a user-friendly error message (not the raw error)
   - Provide a "Try Again" button calling `reset()`
   - Provide a "Return Home" link
   - Log the error to console (for debugging)
   - Use existing Tailwind classes from the project (`card`, `btn-primary`, `banner-error`)

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Temporarily throw an error in ClockPageClient  verify error.tsx catches it
```

**Rollback:** Delete the four files.

<details>
<summary><strong>AGENT PROMPT  Step 2.1</strong></summary>

```
PERSONA: Kimi/UI (React / Next.js App Router / Tailwind)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Read src/AGENTS.md first. Line 25: Use 'use client' strictly for interactivity. Line 54: Mobile first (375px).

TASK: Create error.tsx error boundary files for Next.js App Router

CONTEXT:
- Finding FE-08: No error boundaries exist anywhere in the app. An unhandled exception causes a white screen.
- Next.js App Router uses `error.tsx` files as automatic error boundaries per route segment.

INSTRUCTIONS:
1. Read `src/app/layout.tsx` to understand the existing layout structure and CSS classes.
2. Read `src/app/clock/page.tsx` to understand the existing page structure.
3. Look at existing components to identify CSS class patterns (search for `card`, `btn-primary`, `banner`).

4. Create FOUR error boundary files:

   a. `src/app/error.tsx`  Root-level error boundary:
      - "use client" directive
      - Props: { error: Error & { digest[X]: string }, reset: () => void }
      - Display: "Something went wrong" message in a centered card
      - Buttons: "Try Again" (calls reset()), link to "/" ("Return Home")
      - Console.error the error for debugging
      - Mobile-first layout (centered, padded, max-w-md)

   b. `src/app/clock/error.tsx`  Clock page specific:
      - Same pattern but message: "The clock page encountered an error"
      - Link to "/" and "Try Again" button

   c. `src/app/admin/error.tsx`  Admin specific:
      - Message: "The admin panel encountered an error"

   d. `src/app/run/error.tsx`  Run section:
      - Message: "This page encountered an error"

5. Use existing Tailwind classes from the project. Look at other components for patterns.

CONSTRAINTS:
- Must be "use client" components (Next.js requirement for error.tsx)
- Must accept { error, reset } props
- Mobile first  must look good on 375px screens
- Use existing CSS class patterns (card, btn-primary, etc.)
- Do NOT install any new packages

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 2.2  Fix `roundTo30Minutes()` CST Bug

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | FE-06 (rounding operates on local Date, not CST) |
| **Dependencies** | None |
| **Files** | MODIFY `src/lib/kioskRules.ts`, MODIFY `src/app/clock/ClockPageClient.tsx` (delete duplicate L50-57) |
| **References** | `kioskRules.ts:52-69`, `ClockPageClient.tsx:50-57` (duplicate), `clockWindows.ts:78-96` (correct CST extraction pattern) |

**AGENTS.md Override:** Line 43 says "Do not touch the rounding logic without explicit instruction." Finding FE-06 documents a correctness bug where `roundTo30Minutes()` uses `nd.getMinutes()` (browser local timezone) instead of CST minutes. This roadmap step IS the explicit instruction to fix it. The function must extract CST minutes via `Intl.DateTimeFormat` before rounding, following the same pattern as `getCstDowMinutes()` in `clockWindows.ts`.

**Deliverables:**
1. Modified `kioskRules.ts:roundTo30Minutes()`:
   - Extract CST hours and minutes using `Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })` (same pattern as `getCstDowMinutes`)
   - Apply rounding rules to CST minutes (not local minutes): `<15  :00`, `15-44  :30`, `45  next hour :00`
   - Reconstruct the Date by calculating the delta between the original CST minutes and the rounded CST minutes, then adding/subtracting that delta from the original Date's UTC time
   - Preserve the function signature: `(d: Date) => Date`
2. Delete duplicate `roundTo30Minutes` from `ClockPageClient.tsx` (L50-57)
3. Update any imports in `ClockPageClient.tsx` to use the `kioskRules.ts` version

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Unit test: roundTo30Minutes(new Date('2026-02-10T14:14:00Z')) with device in EST  should round to CST :00 (8:00 AM CST = 14:00 UTC)
# Unit test: roundTo30Minutes(new Date('2026-02-10T14:44:00Z'))  CST 8:44  rounds to 8:30 CST
# Unit test: roundTo30Minutes(new Date('2026-02-10T14:45:00Z'))  CST 8:45  rounds to 9:00 CST
# DST test: March 9, 2026 (spring forward) boundary values
```

**Rollback:** Revert both files.

<details>
<summary><strong>AGENT PROMPT  Step 2.2</strong></summary>

```
PERSONA: Codex (TypeScript / Timezone Logic)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Read src/AGENTS.md first. Line 16: MANUAL CST HANDLING using Intl helpers. Line 43: "Do not touch rounding logic without explicit instruction"  THIS IS THE EXPLICIT INSTRUCTION. Line 61: "roundTo30Minutes historically had off-by-one-hour bugs."

TASK: Fix roundTo30Minutes() to operate on CST minutes, not local timezone minutes

CONTEXT:
- Finding FE-06: `roundTo30Minutes()` in `src/lib/kioskRules.ts` (lines 52-69) uses `nd.getMinutes()` and `nd.setMinutes()` which operate in the BROWSER'S local timezone, not CST.
- There is a DUPLICATE copy at `src/app/clock/ClockPageClient.tsx` lines 50-57 that must be deleted.
- The correct CST extraction pattern already exists in `src/lib/clockWindows.ts:getCstDowMinutes()` (lines 78-96) using Intl.DateTimeFormat.

INSTRUCTIONS:
1. Read `src/lib/kioskRules.ts` completely (70 lines).
2. Read `src/lib/clockWindows.ts` lines 78-96 to see the correct CST extraction pattern.
3. Read `src/app/clock/ClockPageClient.tsx` lines 40-60 to see the duplicate.

4. Modify `src/lib/kioskRules.ts`:
   - Rewrite `roundTo30Minutes(d: Date): Date` to:
     a. Extract CST hours and minutes using Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
     b. Apply rounding rules to CST minutes:
        - minutes < 15  round to :00 (delta = -minutes)
        - minutes < 45  round to :30 (delta = 30 - minutes)
        - minutes >= 45  round to next hour :00 (delta = 60 - minutes)
     c. Return new Date(d.getTime() + delta * 60000)
   - Keep the function signature identical: (d: Date) => Date
   - Keep the JSDoc comment but update it to mention CST-aware rounding

5. Modify `src/app/clock/ClockPageClient.tsx`:
   - DELETE the duplicate `roundTo30Minutes` function (lines 50-57)
   - ADD an import: `import { roundTo30Minutes } from "@/lib/kioskRules";`
   - If `roundTo30Minutes` is already imported elsewhere in the file, just remove the duplicate definition

CONSTRAINTS:
- The function signature MUST remain (d: Date) => Date
- Do NOT use moment, luxon, or any date library (AGENTS.md line 16)
- Use the same Intl.DateTimeFormat pattern as clockWindows.ts
- The rounding rules remain: <15:00, 15-44:30, 45next hour :00

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 2.3  Extract `clockHelpers.ts` (Refactor Step 1)

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | FE-07 (logic duplication), Refactor Plan Step 1 |
| **Dependencies** | Step 2.2 (FE-06 fix must be in place  the extracted helpers include the fixed `roundTo30Minutes` import) |
| **Files** | CREATE `src/app/clock/lib/clockHelpers.ts`, MODIFY `src/app/clock/ClockPageClient.tsx` |
| **References** | `ClockPageClient.tsx:40-155` (9 pure functions) |

**Context:** ClockPageClient.tsx contains 9 pure utility functions defined at the top of the file (lines 40-155). These are independently testable and have no dependency on React state. Extracting them reduces ClockPageClient by ~100 lines and enables unit testing.

**Deliverables:**
1. CREATE `src/app/clock/lib/clockHelpers.ts` containing:
   - `toLocalInputValue()` (L40-48)
   - `formatDateTime()` (L59-69)
   - `getCstOffsetMinutes()` (L71-89)
   - `toCstDateFromLocalInput()` (L91-100)
   - `toCstMinutes()` (L102-106)  delegates to `getCstDowMinutes` from clockWindows.ts
   - `getStoreShiftStarts()` (L108-128)
   - `inferShiftKind()` (L130-142)
   - `formatCst()` (L144-155)
   - Re-export `roundTo30Minutes` from `@/lib/kioskRules` for convenience
2. MODIFY `ClockPageClient.tsx`:
   - Delete lines 40-155 (the function definitions)
   - Add `import { toLocalInputValue, formatDateTime, ... } from "./lib/clockHelpers";`
   - Verify all references still resolve

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Clock page should render and function identically
```

**Rollback:** Delete `clockHelpers.ts`, revert `ClockPageClient.tsx`.

<details>
<summary><strong>AGENT PROMPT  Step 2.3</strong></summary>

```
PERSONA: Codex (TypeScript / Module Extraction)
PROJECT: Shift Happens  Workforce Management App

TASK: Extract pure utility functions from ClockPageClient.tsx into clockHelpers.ts

CONTEXT:
- Refactor Plan Step 1: Extract 9 pure functions from ClockPageClient.tsx (lines 40-155) into a dedicated helpers module.
- Step 2.2 already deleted the duplicate roundTo30Minutes from ClockPageClient and fixed the one in kioskRules.ts. So roundTo30Minutes should be re-exported from clockHelpers for convenience.

INSTRUCTIONS:
1. Read `src/app/clock/ClockPageClient.tsx` lines 1-160 to see all the pure functions.
2. Note which functions depend on which imports (clockWindows.ts, kioskRules.ts, etc.).

3. Create `src/app/clock/lib/clockHelpers.ts`:
   - Move these functions (preserving their exact implementations):
     * toLocalInputValue (creates datetime-local string from Date)
     * formatDateTime (formats a date string for display)
     * getCstOffsetMinutes (calculates CST offset in minutes)
     * toCstDateFromLocalInput (converts datetime-local input to CST-correct UTC Date)
     * toCstMinutes (delegates to getCstDowMinutes)
     * getStoreShiftStarts (returns store-specific shift start hours)
     * inferShiftKind (infers shift type from time and store)
     * formatCst (formats Date in America/Chicago timezone)
   - Re-export roundTo30Minutes: `export { roundTo30Minutes } from "@/lib/kioskRules";`
   - Include all necessary imports at the top of the new file
   - Export all functions as named exports

4. Modify `src/app/clock/ClockPageClient.tsx`:
   - Delete the function definitions (approximately lines 40-155  but verify exact boundaries)
   - Add import statement: `import { toLocalInputValue, formatDateTime, getCstOffsetMinutes, toCstDateFromLocalInput, toCstMinutes, getStoreShiftStarts, inferShiftKind, formatCst, roundTo30Minutes } from "./lib/clockHelpers";`
   - Remove any imports that were only used by the moved functions (unless still needed)
   - Verify all function references in the component body still resolve

CONSTRAINTS:
- Do NOT modify any function implementations  pure move only
- Preserve all TypeScript types
- The roundTo30Minutes duplicate was already deleted in Step 2.2  just re-export from kioskRules

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

## Phase 3: Frontend Decomposition

> **Goal:** Extract all sub-components from ClockPageClient.tsx BEFORE introducing the state machine.
> **Rationale:** Each extraction is independently deployable and testable. The error boundaries from Phase 2 catch regressions. After all extractions, ClockPageClient will be ~600-700 lines (down from 1,518), making the Phase 5 reducer rewrite manageable.
> **Estimated Time:** 3-4 hours

---

### Step 3.1  Extract StaleShiftConfirmations + ClockWindowAlarmModal

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | FE-13, FE-21 (component at wrong scope), Refactor Steps 2-3 |
| **Dependencies** | Step 2.3 (imports clockHelpers) |
| **Files** | CREATE `src/app/clock/components/StaleShiftConfirmations.tsx`, CREATE `src/app/clock/components/ClockWindowAlarmModal.tsx`, MODIFY `ClockPageClient.tsx` |
| **References** | `ClockPageClient.tsx:1448-1516` (StaleShiftConfirmations), `ClockPageClient.tsx:1424-1443` (alarm modal) |

**Context:** `StaleShiftConfirmations` is already defined at module scope (after the main component export) but should be in its own file. `ClockWindowAlarmModal` is a self-contained ~20-line modal. Both are zero-risk extractions.

**Deliverables:**
1. `StaleShiftConfirmations.tsx`  move from L1448-1516, add `React.memo`, typed props interface
2. `ClockWindowAlarmModal.tsx`  move from L1424-1443, `createPortal` to document.body
3. Update `ClockPageClient.tsx` imports

**Verification:**
```bash
npx tsc --noEmit
npm run build
```

**Rollback:** Delete new files, revert ClockPageClient.

<details>
<summary><strong>AGENT PROMPT  Step 3.1</strong></summary>

```
PERSONA: Kimi/UI (React / Component Extraction)
PROJECT: Shift Happens  Workforce Management App

TASK: Extract StaleShiftConfirmations and ClockWindowAlarmModal from ClockPageClient.tsx

CONTEXT:
- Refactor Steps 2 & 3: StaleShiftConfirmations (lines 1448-1516) is defined at module scope but should be its own file. ClockWindowAlarmModal (lines 1424-1443) is a self-contained modal.
- These are the lowest-risk extractions  no state management changes.

INSTRUCTIONS:
1. Read `src/app/clock/ClockPageClient.tsx` lines 1420-1518 to see both components.
2. Read the Props interfaces from REFACTOR_PLAN_CLOCK_CLIENT.md (StaleShiftConfirmationsProps, ClockWindowAlarmModalProps).

3. Create `src/app/clock/components/StaleShiftConfirmations.tsx`:
   - "use client" directive
   - Move the StaleShiftConfirmations function from ClockPageClient.tsx
   - Add typed StaleShiftConfirmationsProps interface
   - Wrap with React.memo
   - Import isOutOfThreshold, thresholdMessage from "@/lib/kioskRules"
   - Export as default

4. Create `src/app/clock/components/ClockWindowAlarmModal.tsx`:
   - "use client" directive
   - Move the alarm modal JSX from ClockPageClient.tsx
   - Props: { open: boolean; windowLabel: string; onClose: () => void }
   - Use createPortal to document.body
   - Export as default

5. Modify ClockPageClient.tsx:
   - Delete the moved code
   - Add imports for both new components
   - Replace inline usage with component references

CONSTRAINTS:
- Preserve exact visual behavior  no CSS changes
- These are "use client" components
- Do NOT change any state management  components receive data via props only

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 3.2  Extract UnscheduledPromptModal + ConfirmationModal

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | Refactor Steps 4-5 |
| **Dependencies** | Step 2.1 (error boundaries as safety net) |
| **Files** | CREATE `src/app/clock/components/UnscheduledPromptModal.tsx`, CREATE `src/app/clock/components/ConfirmationModal.tsx`, MODIFY `ClockPageClient.tsx` |
| **References** | `ClockPageClient.tsx:748-777` (unscheduled), `ClockPageClient.tsx:1377-1422` (confirmation) |

**Deliverables:**
1. `UnscheduledPromptModal.tsx`  props: `{ open, storeName, plannedLabel, onCancel, onContinue }`
2. `ConfirmationModal.tsx`  props: `{ open, profileName, storeName, plannedStartLabel, plannedStartRoundedLabel, onConfirm, onCancel, submitting }`
3. Updated `ClockPageClient.tsx` imports

**Verification:**
```bash
npx tsc --noEmit
npm run build
```

**Rollback:** Delete new files, revert ClockPageClient.

<details>
<summary><strong>AGENT PROMPT  Step 3.2</strong></summary>

```
PERSONA: Kimi/UI (React / Component Extraction)
PROJECT: Shift Happens  Workforce Management App

TASK: Extract UnscheduledPromptModal and ConfirmationModal from ClockPageClient.tsx

INSTRUCTIONS:
1. Read `src/app/clock/ClockPageClient.tsx` lines 745-780 (unscheduled prompt modal JSX).
2. Read lines 1375-1425 (confirmation modal JSX).
3. Read REFACTOR_PLAN_CLOCK_CLIENT.md for Props interfaces.

4. Create `src/app/clock/components/UnscheduledPromptModal.tsx`:
   - "use client", createPortal to document.body
   - Props: { open, storeName, plannedLabel, onCancel, onContinue }
   - Move the unscheduled prompt modal JSX

5. Create `src/app/clock/components/ConfirmationModal.tsx`:
   - "use client", createPortal to document.body
   - Props: { open, profileName, storeName, plannedStartLabel, plannedStartRoundedLabel, onConfirm, onCancel, submitting }
   - Includes internal confirmChecked state (checkbox before confirm)
   - Move the confirmation modal JSX

6. Update ClockPageClient.tsx:
   - Delete moved code
   - Import and use new components
   - Pass appropriate props

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 3.3  Extract OpenShiftModal

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | Refactor Step 6 |
| **Dependencies** | Step 2.1 |
| **Files** | CREATE `src/app/clock/components/OpenShiftModal.tsx`, MODIFY `ClockPageClient.tsx` |
| **References** | `ClockPageClient.tsx:959-1004` |

**Deliverables:**
1. `OpenShiftModal.tsx`  props: `{ open, profileName, shiftInfo, qrToken, onReturnToShift, onEndPreviousShift, onClose }`
2. Navigation logic (`router.replace`) stays in parent  modal calls callbacks
3. Updated `ClockPageClient.tsx`

**Verification:**
```bash
npx tsc --noEmit
npm run build
```

**Rollback:** Delete file, revert ClockPageClient.

<details>
<summary><strong>AGENT PROMPT  Step 3.3</strong></summary>

```
PERSONA: Kimi/UI (React / Component Extraction)
PROJECT: Shift Happens  Workforce Management App

TASK: Extract OpenShiftModal from ClockPageClient.tsx

INSTRUCTIONS:
1. Read `src/app/clock/ClockPageClient.tsx` lines 955-1010 (open shift modal).
2. Read REFACTOR_PLAN_CLOCK_CLIENT.md for OpenShiftModalProps interface.

3. Create `src/app/clock/components/OpenShiftModal.tsx`:
   - "use client", createPortal
   - Props: { open, profileName, shiftInfo: OpenShiftInfo, qrToken, onReturnToShift, onEndPreviousShift, onClose }
   - Define the OpenShiftInfo type (or import from a shared types file)
   - Move the open shift modal JSX
   - The router.replace() logic should be handled by the parent via callbacks  the modal just calls onReturnToShift/onEndPreviousShift/onClose

4. Update ClockPageClient.tsx:
   - Delete moved code
   - Import and use new component
   - Wire callbacks to existing handler functions (which contain router.replace)

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 3.4  Extract StaleShiftCloseModal (Highest-Risk Modal)

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | Refactor Step 7 |
| **Dependencies** | Step 2.1 (error boundary safety net) |
| **Files** | CREATE `src/app/clock/components/StaleShiftCloseModal.tsx`, MODIFY `ClockPageClient.tsx` |
| **References** | `ClockPageClient.tsx:1006-1195` (~190 lines, contains 9 state variables + async handler) |

**Context:** This is the highest-risk modal extraction. The stale shift close flow contains 9 state variables (`staleEndLocal`, `staleDrawer`, `staleChangeDrawer`, `staleConfirm`, `staleNotify`, `staleNote`, `staleDoubleCheck`, `staleSaving`, `staleError`) and an inline async submit handler (L1105-1186). All 9 state variables should be moved INTO this component  they are self-contained.

**Deliverables:**
1. `StaleShiftCloseModal.tsx`:
   - Owns all 9 stale-shift state variables internally
   - Props: `{ open, profileName, shiftInfo, onClose, onReturnToShift, onEndAndStart: (data: StaleShiftCloseData) => Promise<void>, saving, error }`
   - The `onEndAndStart` callback receives structured data, parent handles the API call
   - Uses `StaleShiftConfirmations` component (from Step 3.1)
   - Uses `DrawerCountFields`-like inline fields (or simple inline inputs until Step 9)
2. `ClockPageClient.tsx`:
   - Delete 9 `useState` variables for stale shift
   - Delete ~190 lines of modal JSX
   - Import and render `StaleShiftCloseModal`

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Test the full stale shift close flow  open shift detected  click "End Previous"  fill drawer  submit
```

**Rollback:** Delete file, revert ClockPageClient.

<details>
<summary><strong>AGENT PROMPT  Step 3.4</strong></summary>

```
PERSONA: Kimi/UI (React / Component Extraction  High Risk)
PROJECT: Shift Happens  Workforce Management App

TASK: Extract StaleShiftCloseModal from ClockPageClient.tsx (highest-risk modal)

CONTEXT:
- Refactor Step 7: This modal owns 9 state variables and contains an async submit handler.
- The state variables (staleEndLocal, staleDrawer, staleChangeDrawer, staleConfirm, staleNotify, staleNote, staleDoubleCheck, staleSaving + error state) are SELF-CONTAINED  they don't affect any other part of ClockPageClient.
- The StaleShiftConfirmations component was already extracted in Step 3.1.

INSTRUCTIONS:
1. Read `src/app/clock/ClockPageClient.tsx` lines 1000-1200 completely (the stale shift close modal section).
2. Read lines 208-216 to see the 9 useState variables being moved.
3. Read REFACTOR_PLAN_CLOCK_CLIENT.md for StaleShiftCloseModalProps and StaleShiftCloseData interfaces.

4. Create `src/app/clock/components/StaleShiftCloseModal.tsx`:
   - "use client", createPortal
   - MOVE these 9 state variables INTO this component:
     * staleEndLocal, staleDrawer, staleChangeDrawer
     * staleConfirm, staleNotify, staleNote
     * staleDoubleCheck, staleSaving (+ any error state for this modal)
   - Props: { open, profileName, shiftInfo: OpenShiftInfo, onClose, onReturnToShift, onEndAndStart: (data: StaleShiftCloseData) => Promise<void> }
   - The component handles its own form state and validation
   - On submit, it calls onEndAndStart() with structured data  the parent handles the API call
   - Import and use StaleShiftConfirmations from Step 3.1
   - Define StaleShiftCloseData type: { endAt, endDrawerCents, changeDrawerCents, confirmed, notifiedManager, note }

5. Modify ClockPageClient.tsx:
   - DELETE the 9 useState declarations for stale shift state
   - DELETE the ~190 lines of stale shift modal JSX
   - Import StaleShiftCloseModal
   - Create the onEndAndStart callback that calls the end-shift API (move the existing async handler logic to this callback)
   - Pass saving/error state via a local wrapper if needed

CONSTRAINTS:
- HIGHEST-RISK extraction  be extremely careful to preserve all validation logic
- The drawer threshold checking logic must work identically
- The "double shift" checkbox logic must be preserved
- The formatDateTime and formatCst helpers should be imported from clockHelpers.ts

VERIFICATION:
- npx tsc --noEmit
- npm run build
- Manual test: full stale shift close flow must work end-to-end
```

</details>

---

### Step 3.5  Replace Inline PIN Modal with PinGate

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | FE-03 (178-line duplication) |
| **Dependencies** | Step 3.4 (stale-shift modal extracted first  reduces ClockPageClient complexity before PIN swap) |
| **Files** | MODIFY `src/components/PinGate.tsx` (add `onProfileInfo` callback), MODIFY `ClockPageClient.tsx` (delete L1197-1374) |
| **References** | `PinGate.tsx:1-317`, `ClockPageClient.tsx:1197-1374` (inline duplicate) |

**Context:** ClockPageClient contains a 178-line inline PIN modal (L1197-1374) that duplicates the existing `PinGate.tsx` component almost line-for-line. PinGate is used on the home page but NOT on the clock page. The only difference: the inline version also sets `authenticatedProfileName` and stores profile name in sessionStorage.

**Deliverables:**
1. Modified `PinGate.tsx`:
   - Add optional `onProfileInfo[X]: (name: string) => void` callback prop
   - Call it after successful auth with the profile name from the edge function response (L271 in current PinGate)
2. Modified `ClockPageClient.tsx`:
   - Delete the entire inline PIN modal (L1197-1374, ~178 lines)
   - Delete the 9 PIN-related `useState` variables (L218-230) that are now internal to PinGate
   - Import and render `<PinGate>` with appropriate props
   - Wire `onProfileInfo` to set `authenticatedProfileName`
   - Wire `onAuthorized` to receive the PIN token

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Complete PIN auth flow on clock page  verify profile name shows correctly
# Manual: Verify sessionStorage keys are set correctly (sh_pin_token, sh_pin_store_id, sh_pin_profile_id, sh_profile_name)
```

**Rollback:** Revert both files.

<details>
<summary><strong>AGENT PROMPT  Step 3.5</strong></summary>

```
PERSONA: Kimi/UI (React / Component Integration)
PROJECT: Shift Happens  Workforce Management App

TASK: Replace inline PIN modal in ClockPageClient with PinGate component

CONTEXT:
- Finding FE-03: ClockPageClient.tsx lines 1197-1374 contain a 178-line inline PIN modal that duplicates the existing PinGate.tsx component.
- PinGate.tsx is already used on the home page (src/app/page.tsx)  it handles employee code, PIN input, auth, sessionStorage.
- The only missing feature: PinGate doesn't expose the profile name after auth. The inline version sets `authenticatedProfileName` and stores it in sessionStorage.

INSTRUCTIONS:
1. Read `src/components/PinGate.tsx` completely (317 lines).
2. Read `src/app/clock/ClockPageClient.tsx` lines 1195-1380 (the inline PIN modal).
3. Read ClockPageClient.tsx lines 218-230 (the PIN-related useState variables).
4. Read the home page (`src/app/page.tsx`) to see how PinGate is currently used.

5. Modify `src/components/PinGate.tsx`:
   - Add optional prop: `onProfileInfo[X]: (name: string) => void`
   - In the auth success handler (around line 271 where `profileName` is available), call: `onProfileInfo[X].(profileName)`
   - This is a BACKWARD-COMPATIBLE change  existing usage doesn't pass this prop

6. Modify `src/app/clock/ClockPageClient.tsx`:
   - DELETE the inline PIN modal JSX (approximately lines 1197-1374)
   - DELETE the PIN-related useState variables that are now handled internally by PinGate:
     * pinValue, pinError, pinLoading, pinShake (UI state  internal to PinGate)
     * Keep pinToken, pinStoreId, pinProfileId if the parent still needs them for API calls
   - Import PinGate: `import PinGate from "@/components/PinGate";`
   - Render PinGate where the inline modal was:
     <PinGate
       loading={loading}
       stores={stores}
       qrToken={qrToken}
       tokenStore={tokenStore}
       storeId={storeId}
       setStoreId={setStoreId}
       profileId={profileId}
       setProfileId={setProfileId}
       onLockChange={(locked) => setPinLockedSelection(locked)}
       onAuthorized={(token) => setPinToken(token)}
       onProfileInfo={(name) => setAuthenticatedProfileName(name)}
       onClose={undefined}  // clock page doesn't have a close option
     />

CONSTRAINTS:
- Backward-compatible change to PinGate (existing home page usage must still work)
- PIN auth flow must be functionally identical on clock page
- sessionStorage keys must remain the same (sh_pin_token, sh_pin_store_id, sh_pin_profile_id)
- Do NOT change PinGate's existing behavior  only add the new optional callback

VERIFICATION:
- npx tsc --noEmit
- npm run build
- Manual: PIN auth on clock page must work identically
- Manual: PIN auth on home page must still work (regression check)
- Manual: Verify sh_profile_name is set in sessionStorage after auth
```

</details>

---

## Phase 4: API Contract Stabilization

> **Goal:** Fix remaining backend issues that affect API response shapes or audit trails.
> **Rationale:** These changes must be stable before Phase 5 builds frontend hooks against the APIs.
> **Estimated Time:** 2-3 hours

---

### Step 4.1  manualClose Audit Trail

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | F-02 (no audit trail for manual close override) |
| **Dependencies** | Step 1.2 (atomic RPC awareness  don't duplicate rollback patterns) |
| **Files** | MODIFY `src/app/api/end-shift/route.ts` (lines 246-258) |
| **References** | `end-shift/route.ts:246-264` (auto-inserts checklist checks without logging) |

**Context:** When `manualClose=true`, the end-shift route auto-inserts `shift_checklist_checks` rows for ALL missing required items. No audit trail records who triggered the override or when. Any authenticated employee can bypass their checklist.

**Deliverables:**
1. Modified `end-shift/route.ts`:
   - After the auto-insert of checklist checks (L246-258), insert an audit log record
   - Include: `actor_profile_id`, `shift_id`, `action: 'manual_close_override'`, `timestamp`, `note: 'Checklist auto-completed via manualClose flag'`
   - Use the existing audit log table/pattern (check if `request_audit_log` or similar exists)
   - If no audit table exists for shifts, add a `note` field to the shift record itself

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: End a shift with manualClose=true  verify audit record is created
```

**Rollback:** Revert the single file.

<details>
<summary><strong>AGENT PROMPT  Step 4.1</strong></summary>

```
PERSONA: Codex (TypeScript API Routes)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Lines 48-49 (end-shift is high-risk).

TASK: Add audit trail for manualClose checklist override in end-shift route

CONTEXT:
- Finding F-02: `src/app/api/end-shift/route.ts` lines 246-264 auto-insert shift_checklist_checks when manualClose=true. No audit trail, no logging of who triggered it.

INSTRUCTIONS:
1. Read `src/app/api/end-shift/route.ts` completely.
2. Search for any existing audit log table (request_audit_log, shift_audit_log, or similar).
3. If an audit table exists, use it. If not, add a `manual_close_note` field to the shift update.

4. Modify end-shift/route.ts:
   - After the auto-insert block at lines 246-258, add an audit record
   - Record: who (profile_id from auth), what (manual close override, N items auto-completed), when (now), which shift (shift_id)
   - If using shift update: add to the shift's note field
   - If using audit table: INSERT a row

CONSTRAINTS:
- High-risk file  be surgical
- Do NOT change any other logic in the route
- The audit record must identify the actor (profile that triggered manual close)

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 4.2  Admin Drawer Count Audit

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | F-03 (silent auto-creation of drawer counts) |
| **Dependencies** | None |
| **Files** | MODIFY `src/app/api/admin/shifts/[shiftId]/route.ts` (lines 96-140) |
| **References** | Admin PATCH with `endedAt` auto-creates missing `shift_drawer_counts` |

**Context:** When an admin edits a shift to add `endedAt`, the route auto-creates missing drawer counts at the store's expected amount with a generic note. The creating manager's identity is not recorded.

**Deliverables:**
1. Modified `admin/shifts/[shiftId]/route.ts`:
   - Include the manager's profile_id/user_id in the drawer count note: `"Admin edit by [manager_name] (missing count)"`
   - Add the manager's user ID as a field if the table supports it, or encode in the note

**Verification:**
```bash
npx tsc --noEmit
npm run build
```

**Rollback:** Revert the single file.

<details>
<summary><strong>AGENT PROMPT  Step 4.2</strong></summary>

```
PERSONA: Codex (TypeScript API Routes)
PROJECT: Shift Happens

TASK: Add manager identity to admin drawer count auto-creation

CONTEXT:
- Finding F-03: `src/app/api/admin/shifts/[shiftId]/route.ts` lines 96-140 auto-creates drawer counts with a generic "Admin edit (missing count)" note. No record of WHICH admin did it.

INSTRUCTIONS:
1. Read `src/app/api/admin/shifts/[shiftId]/route.ts` completely.
2. Identify how the manager's identity is obtained (likely from Supabase auth.getUser or similar).
3. Modify the auto-create logic to include the manager's identity in the note field.
4. Format: "Admin edit by {manager_email_or_name} (missing {count_type} count)"

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 4.3  Transactional Profile Creation

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | F-05 (orphaned profiles) |
| **Dependencies** | None |
| **Files** | CREATE `src/app/sql/47_create_profile_with_memberships.sql`, MODIFY `src/app/api/admin/users/route.ts` |
| **References** | `admin/users/route.ts:122-135` (two separate Supabase calls) |

**Context:** Profile creation and store_memberships insertion are two separate calls. If membership insert fails, the profile is orphaned (exists with no store assignments, invisible in admin UI).

**Deliverables:**
1. `47_create_profile_with_memberships.sql`:
   - New RPC `create_profile_with_memberships(p_name, p_employee_code, p_store_ids uuid[], ...)` that atomically creates the profile AND inserts all store memberships
   - `SECURITY DEFINER SET search_path = public`
2. Modified `admin/users/route.ts`:
   - Replace the two-step profile + membership creation with a single `.rpc('create_profile_with_memberships', {...})` call

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Create a new employee with 2 store memberships  verify both profile and memberships exist
# Manual: Create with invalid store_id  verify no orphaned profile
```

**Rollback:** Revert route, drop RPC.

<details>
<summary><strong>AGENT PROMPT  Step 4.3</strong></summary>

```
PERSONA: Codex (SQL + TypeScript)
PROJECT: Shift Happens

TASK: Create atomic profile+memberships RPC

CONTEXT:
- Finding F-05: Profile creation and store_memberships are two separate calls in admin/users/route.ts (lines 122-135). Membership failure orphans the profile.

INSTRUCTIONS:
1. Read `src/app/api/admin/users/route.ts` completely.
2. Read the profiles and store_memberships table schemas from AUDIT_PHASE_1_SCHEMA.md or the SQL files.

3. Create `src/app/sql/47_create_profile_with_memberships.sql`:
   - RPC that takes profile fields + array of store_ids
   - INSERT profile, then INSERT store_memberships for each store_id
   - All in one transaction (implicit in PL/pgSQL)
   - RETURNS the new profile row
   - SECURITY DEFINER SET search_path = public

4. Modify admin/users/route.ts:
   - Replace the two-step creation with the new RPC call
   - Handle errors (duplicate name, invalid store_id)

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 4.4  Swap Approval Schedule Status Check

| Field | Value |
|-------|-------|
| **Priority** | LOW |
| **Findings** | F-15 (no schedule status verification at approval) |
| **Dependencies** | None |
| **Files** | CREATE `src/app/sql/48_swap_schedule_status_check.sql` |
| **References** | `28_swap_rpc.sql:599-782` (`approve_shift_swap_or_cover()`) |

**Context:** `approve_shift_swap_or_cover()` does NOT verify that the schedule is still `published` at approval time. If a manager unpublishes a schedule between offer selection and approval, the swap could mutate an unpublished schedule.

**Deliverables:**
1. `48_swap_schedule_status_check.sql`:
   - `CREATE OR REPLACE FUNCTION approve_shift_swap_or_cover(...)` with an added check:
   - Before executing the swap, query the schedule's status and `RAISE EXCEPTION` if not `'published'`

**Verification:**
```bash
npx tsc --noEmit
npm run build
```

**Rollback:** Recreate from original `28_swap_rpc.sql` definition.

<details>
<summary><strong>AGENT PROMPT  Step 4.4</strong></summary>

```
PERSONA: Codex (SQL)
PROJECT: Shift Happens

TASK: Add published schedule verification to approve_shift_swap_or_cover()

CONTEXT:
- Finding F-15: `approve_shift_swap_or_cover()` in `src/app/sql/28_swap_rpc.sql` (lines 599-782) does NOT check that the schedule is still 'published' at approval time.

INSTRUCTIONS:
1. Read `src/app/sql/28_swap_rpc.sql` completely  focus on `approve_shift_swap_or_cover()`.
2. Identify how the schedule is linked (likely through schedule_shifts  schedules).
3. Create `src/app/sql/48_swap_schedule_status_check.sql`:
   - CREATE OR REPLACE the function
   - ADD a check early in the function: query the schedule's status via the schedule_shift's schedule_id
   - IF status <> 'published' THEN RAISE EXCEPTION 'Cannot approve swap: schedule is not published'
   - Preserve ALL existing logic

VERIFICATION:
- Visually verify SQL syntax
```

</details>

---

## Phase 5: Frontend Integration

> **Goal:** Build the frontend hooks and state machine that tie together the extracted components and stabilized APIs.
> **Rationale:** All components exist. All API contracts are stable. Now we wire everything together.
> **Estimated Time:** 5-7 hours

---

### Step 5.1  Extract useShiftActions Hook (Refactor Step 9)

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | Refactor Step 9 |
| **Dependencies** | Step 1.2 (calls the atomic shift RPC via start-shift API), Steps 3.1-3.5 (components exist) |
| **Files** | CREATE `src/app/clock/hooks/useShiftActions.ts`, MODIFY `ClockPageClient.tsx` |
| **References** | `ClockPageClient.tsx:600-733` (startShift function), `ClockPageClient.tsx:1105-1186` (stale shift end+start) |

**Context:** The `startShift()` function (L600-733) and stale shift close handler are currently defined inside ClockPageClient's body. They contain API call logic, error code handling (`UNSCHEDULED`, `CLOCK_WINDOW_VIOLATION`, 409), and response parsing.

**Deliverables:**
1. `useShiftActions.ts`:
   - `startShift(data: StartShiftPayload): Promise<StartShiftResult>`  typed result instead of throwing
   - `endShift(data: EndShiftPayload): Promise<EndShiftResult>`  typed result
   - Centralizes error code handling (UNSCHEDULED, CLOCK_WINDOW_VIOLATION, 409)
   - Returns discriminated union results: `{ ok: true, shiftId, ... } | { ok: false, code: string, ... }`
2. Modified `ClockPageClient.tsx`:
   - Replace inline `startShift()` function with `const { startShift, endShift } = useShiftActions(token)`
   - Handle results via `if (result.ok)` instead of try/catch

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Full clock-in flow, verify all error scenarios still handled
```

**Rollback:** Delete hook, revert ClockPageClient.

<details>
<summary><strong>AGENT PROMPT  Step 5.1</strong></summary>

```
PERSONA: Codex (TypeScript / React Hooks)
PROJECT: Shift Happens  Workforce Management App

TASK: Extract useShiftActions hook from ClockPageClient.tsx

CONTEXT:
- Refactor Step 9: The startShift() function (lines 600-733) and stale shift end-and-restart logic are defined inside ClockPageClient. They handle API calls, error codes, and response parsing.
- Step 1.2 modified the start-shift API to use an atomic RPC  the API response shape should be the same but the backend is now safer.

INSTRUCTIONS:
1. Read `src/app/clock/ClockPageClient.tsx` lines 600-733 (startShift function) completely.
2. Read lines 1105-1186 (stale shift close submit handler).
3. Identify all error codes handled: UNSCHEDULED, CLOCK_WINDOW_VIOLATION, HTTP 409, generic errors.

4. Create `src/app/clock/hooks/useShiftActions.ts`:
   - Define types:
     * StartShiftPayload (matching the JSON body sent to /api/start-shift)
     * StartShiftResult = { ok: true; shiftId: string; shiftType: string; reused: boolean } | { ok: false; code: 'UNSCHEDULED' | 'CLOCK_WINDOW_VIOLATION' | 'CONFLICT' | 'ERROR'; error: string; shiftId[X]: string; storeName[X]: string; plannedLabel[X]: string; windowLabel[X]: string }
     * EndShiftPayload and EndShiftResult similarly
   - Export function useShiftActions(token: string | null):
     * Returns { startShift, endShift } async functions
     * Each function makes the fetch call with Bearer token header
     * Parses response and returns typed result (no throwing)
     * Handles all status codes and error shapes

5. Modify ClockPageClient.tsx:
   - Import useShiftActions
   - Replace inline startShift function with hook call
   - Replace try/catch error handling with result pattern matching
   - Wire the stale shift close flow to use endShift + startShift in sequence

CONSTRAINTS:
- The fetch URLs (/api/start-shift, /api/end-shift) and request shapes must remain identical
- All existing error handling UI (modals, banners) must still trigger correctly
- The token comes from either pinToken or managerAccessToken  pass the correct one

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 5.2  Introduce useClockReducer (HIGHEST RISK)

| Field | Value |
|-------|-------|
| **Priority** | CRITICAL |
| **Findings** | FE-01 (50+ useState), FE-02 (11 useEffect cascades), Refactor Step 10 |
| **Dependencies** | Step 5.1 + ALL Phase 3 steps (all components must be extracted first) |
| **Files** | CREATE `src/app/clock/hooks/useClockReducer.ts`, CREATE `src/app/clock/hooks/useStores.ts`, CREATE `src/app/clock/hooks/useOpenShift.ts`, REWRITE `src/app/clock/ClockPageClient.tsx` to ~250 lines |
| **References** | REFACTOR_PLAN_CLOCK_CLIENT.md Section 3 (full state machine design) |

**THIS IS THE HIGHEST-RISK STEP. Feature branch mandatory. Full regression test before merge.**

**Context:** ClockPageClient currently uses 50+ `useState` variables with implicit state transitions. After all Phase 3 extractions, it should be ~600-700 lines. This step rewrites the state layer to use a `useReducer` with a discriminated union `ClockState` type (10 phases, 27 action types). The orchestrator becomes ~250 lines of phase-switch rendering.

**Deliverables:**
1. `useClockReducer.ts`:
   - `ClockState` discriminated union (10 phases from REFACTOR_PLAN)
   - `ClockAction` union (27 action types from REFACTOR_PLAN)
   - `clockReducer(state, action)` with exhaustive switch
   - Export `useClockReducer()` hook wrapping `useReducer`
2. `useStores.ts`:
   - Replaces effects A, G from Phase 2 audit (store load + localStorage persist)
   - Dispatches `STORES_LOADED` action
3. `useOpenShift.ts`:
   - Replaces effect I (open shift detection)
   - Dispatches `OPEN_SHIFT_DETECTED` action
4. Rewritten `ClockPageClient.tsx` (~250 lines):
   - `const [state, dispatch] = useClockReducer()`
   - `useStores(dispatch, qrToken)`
   - `useOpenShift(state, dispatch)`
   - Phase-switch rendering: `switch (state.phase)`  render appropriate components with props from state

**Verification:**
```bash
npx tsc --noEmit
npm run build
# MANDATORY: Complete regression test of ALL clock flows:
#   1. Normal clock-in (scheduled shift)
#   2. Clock-in with open shift detected (409  OpenShiftModal)
#   3. Clock-in outside clock window (CLOCK_WINDOW_VIOLATION  alarm modal)
#   4. Unscheduled clock-in (UNSCHEDULED  prompt modal)
#   5. Stale shift close  end previous  start new
#   6. PIN auth flow (employee code + PIN)
#   7. Manager auth flow (Supabase session)
#   8. Drawer threshold alert flow
```

**Rollback:** Revert entire feature branch. The previous ClockPageClient (with extracted components) works independently of the reducer.

<details>
<summary><strong>AGENT PROMPT  Step 5.2</strong></summary>

```
PERSONA: Codex (TypeScript / React State Management  HIGHEST RISK)
PROJECT: Shift Happens  Workforce Management App
AGENTS.md: Line 42: ClockPageClient.tsx is "active refactor target."

TASK: Implement useClockReducer state machine and rewrite ClockPageClient orchestrator

 THIS IS THE HIGHEST-RISK STEP IN THE ENTIRE ROADMAP.
 CREATE A FEATURE BRANCH: git checkout -b refactor/clock-reducer
 FULL REGRESSION TEST BEFORE MERGE

CONTEXT:
- ClockPageClient currently has 50+ useState variables and 11 useEffect hooks.
- All sub-components have been extracted (Phases 2-3): StaleShiftCloseModal, OpenShiftModal, ConfirmationModal, UnscheduledPromptModal, ClockWindowAlarmModal, StaleShiftConfirmations, clockHelpers.ts, useShiftActions.ts.
- PinGate.tsx handles PIN auth.
- The state machine design is documented in REFACTOR_PLAN_CLOCK_CLIENT.md Section 3.

INSTRUCTIONS:
1. Read REFACTOR_PLAN_CLOCK_CLIENT.md Section 3 completely  it contains the full ClockState, ClockAction, and reducer design.
2. Read the current ClockPageClient.tsx to understand remaining state after all Phase 3 extractions.
3. Read all extracted components to understand their props interfaces.

4. Create `src/app/clock/hooks/useClockReducer.ts`:
   - Define ClockState discriminated union with 10 phases:
     loading, pin-auth, shift-form, confirming, submitting, open-shift-detected, stale-shift-close, clock-window-alarm, unscheduled-prompt, error, complete
   - Define ClockAction union with ~27 action types (see REFACTOR_PLAN)
   - Implement clockReducer(state: ClockState, action: ClockAction): ClockState
   - Every phase transition must be explicit  invalid actions for a given phase should be no-ops with console.warn
   - Export useClockReducer() hook

5. Create `src/app/clock/hooks/useStores.ts`:
   - Replaces the store loading useEffect (current lines ~368-420)
   - Accepts dispatch function
   - Fetches stores, validates QR token, dispatches STORES_LOADED
   - Handles localStorage persistence

6. Create `src/app/clock/hooks/useOpenShift.ts`:
   - Replaces the open shift detection useEffect (current lines ~536-586)
   - Accepts state and dispatch
   - Only fetches when profileId is available and token exists
   - Dispatches OPEN_SHIFT_DETECTED if found

7. REWRITE `src/app/clock/ClockPageClient.tsx` to ~250 lines:
   - const [state, dispatch] = useClockReducer()
   - const { startShift, endShift } = useShiftActions(...)
   - useStores(dispatch, qrToken)
   - useOpenShift(state, dispatch)
   - Render based on state.phase switch:
     * "loading"  spinner
     * "pin-auth"  <PinGate ...> (dispatches AUTH_SUCCESS)
     * "shift-form"  <ShiftForm> + <DrawerCountFields> (or inline fields)
     * "confirming"  <ConfirmationModal>
     * "submitting"  loading overlay
     * "open-shift-detected"  <OpenShiftModal>
     * "stale-shift-close"  <StaleShiftCloseModal>
     * "clock-window-alarm"  <ClockWindowAlarmModal>
     * "unscheduled-prompt"  <UnscheduledPromptModal>
     * "error"  error banner with retry
     * "complete"  redirect

CONSTRAINTS:
- Do NOT mix old useState with new reducer  clean break
- Every component prop must come from state fields  no derived state in the orchestrator
- The reducer must be a PURE function  no side effects, no API calls
- Side effects (API calls, navigation) happen in event handlers that dispatch actions
- Feature branch mandatory: refactor/clock-reducer

VERIFICATION:
- npx tsc --noEmit
- npm run build
- Full manual regression test (8 scenarios listed in the step above)
```

</details>

---

### Step 5.3  JWT Expiry Tracking + PIN Debouncing

| Field | Value |
|-------|-------|
| **Priority** | HIGH |
| **Findings** | FE-04 (no expiry tracking), FE-05 (no PIN debounce) |
| **Dependencies** | Step 3.5 (PinGate is the single PIN auth component) |
| **Files** | CREATE `src/app/clock/hooks/useTokenExpiry.ts`, MODIFY `src/components/PinGate.tsx` |
| **References** | JWT has 4hr expiry, no client-side tracking |

**Context:** The PIN JWT is valid for 4 hours with no client-side expiry awareness. An employee could work a 6-hour shift and lose API access mid-operation. Also, there's no client-side rate limiting on PIN attempts.

**Deliverables:**
1. `useTokenExpiry.ts`:
   - Decode JWT `exp` claim (base64 decode  no library needed for reading exp)
   - Set a timer to dispatch a warning at T-15min
   - Force re-auth dispatch at expiry
   - Store `exp` alongside token in sessionStorage
2. Modified `PinGate.tsx`:
   - Add client-side rate limiting: disable submit for 2s after failure
   - After 3 failures: show exponential backoff timer matching server lockout behavior
   - Display attempt count to user

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Authenticate with PIN  verify expiry timer is set (check with React DevTools)
# Manual: Enter wrong PIN 3 times  verify client-side cooldown activates
```

**Rollback:** Delete hook, revert PinGate.

<details>
<summary><strong>AGENT PROMPT  Step 5.3</strong></summary>

```
PERSONA: Codex (TypeScript / Security / React Hooks)
PROJECT: Shift Happens

TASK: Add JWT expiry tracking and PIN input debouncing

CONTEXT:
- Finding FE-04: No client-side JWT expiry awareness. 4hr token with no warning.
- Finding FE-05: No client-side rate limiting on PIN attempts. Only server-side 429.

INSTRUCTIONS:
1. Create `src/app/clock/hooks/useTokenExpiry.ts`:
   - Accept token string
   - Decode the JWT payload (split on '.', base64-decode middle segment, parse JSON)
   - Extract `exp` claim (Unix timestamp)
   - Set setTimeout to warn at (exp - 15min)
   - Set setTimeout to force re-auth at exp
   - Return { expiresAt: Date | null, isExpiringSoon: boolean, isExpired: boolean }
   - Clean up timers on unmount

2. Modify `src/components/PinGate.tsx`:
   - Add state: failedAttempts count, cooldownUntil timestamp
   - After failed auth attempt: increment failedAttempts
   - If failedAttempts >= 1: disable submit for 2 seconds
   - If failedAttempts >= 3: exponential backoff (2s, 4s, 8s...)
   - Show countdown timer during cooldown
   - Reset failedAttempts on successful auth

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 5.4  Toast System + Zod Client-Side Validation

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | FE-10 (no toast system), FE-11 (Zod schemas unused on frontend) |
| **Dependencies** | Step 2.1 (layout.tsx is modified for toast provider) |
| **Files** | INSTALL `sonner`, CREATE `src/components/ToastProvider.tsx`, CREATE `src/schemas/clockForm.ts`, MODIFY `src/app/layout.tsx` |
| **References** | `schemas/requests.ts:1-47` (existing Zod schemas, unused on frontend) |

**Context:** All errors are shown as inline banners that can be off-screen. No success feedback before redirects. Zod schemas exist server-side but are never imported by frontend code.

**Deliverables:**
1. Install `sonner` (lightweight toast library)
2. `ToastProvider.tsx`  wraps Sonner's `<Toaster>` with project styling
3. Modified `layout.tsx`  add `<ToastProvider>` inside the body
4. `clockForm.ts`  Zod schemas for clock-in form fields (validates before API submission)
5. Update ClockPageClient to use `toast.success()` / `toast.error()` for feedback

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Start a shift successfully  verify success toast appears
# Manual: Submit with invalid drawer amount  verify inline validation message
```

**Rollback:** `npm uninstall sonner`, delete new files, revert layout.tsx.

<details>
<summary><strong>AGENT PROMPT  Step 5.4</strong></summary>

```
PERSONA: Kimi/UI (React / UX / Validation)
PROJECT: Shift Happens
AGENTS.md: Line 54: Mobile first (375px).

TASK: Add toast notification system and client-side Zod validation

CONTEXT:
- Finding FE-10: No toast system. Errors shown as inline banners that can be off-screen.
- Finding FE-11: Zod schemas exist in src/schemas/requests.ts but are never imported on the frontend.

INSTRUCTIONS:
1. Install sonner: npm install sonner
2. Create `src/components/ToastProvider.tsx`:
   - "use client"
   - Import { Toaster } from "sonner"
   - Style to match project theme (dark, bottom-right, mobile-responsive)
   - Export default

3. Modify `src/app/layout.tsx`:
   - Import ToastProvider
   - Add <ToastProvider /> inside the <body> tag

4. Create `src/schemas/clockForm.ts`:
   - Import { z } from "zod"
   - Define clockInSchema for the start-shift form fields
   - Define staleShiftCloseSchema for the stale shift form fields
   - Validate drawer amounts (positive integers when required), planned start (valid date), etc.

5. Update ClockPageClient.tsx (or useShiftActions.ts):
   - Import { toast } from "sonner"
   - Call toast.success("Shift started!") on successful clock-in
   - Call toast.error(message) for non-blocking errors
   - Before API submission, validate with Zod schema  show field-level errors

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

## Phase 6: Hardening

> **Goal:** Security hardening, JWT tightening, and low-priority fixes.
> **Rationale:** These are defense-in-depth measures that build on the stable foundation from Phases 1-5.
> **Estimated Time:** 2-3 hours

---

### Step 6.1  Cron Replay Protection

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | F-09 (no replay protection on cron endpoints) |
| **Dependencies** | None |
| **Files** | MODIFY `src/app/api/cron/*/route.ts` (both cron routes) |
| **References** | Cron endpoints use simple `x-cron-secret` header comparison |

**Deliverables:**
1. Modified cron routes:
   - Add timestamp verification: reject requests with `x-cron-timestamp` more than 60 seconds old
   - Add audit logging: log each cron invocation (timestamp, endpoint, duration)
   - Consider using Vercel's built-in cron headers for verification if available

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Verify cron endpoints still execute on schedule
# Manual: Replay an old request  should be rejected
```

**Rollback:** Revert cron route files.

<details>
<summary><strong>AGENT PROMPT  Step 6.1</strong></summary>

```
PERSONA: Codex (TypeScript API Routes / Security)
PROJECT: Shift Happens

TASK: Add replay protection and audit logging to cron endpoints

CONTEXT:
- Finding F-09: Cron endpoints use simple x-cron-secret comparison. No replay protection, no audit logging.

INSTRUCTIONS:
1. Find and read all cron route files: src/app/api/cron/*/route.ts
2. Add timestamp verification:
   - Expect x-cron-timestamp header (or use Date header)
   - Reject if timestamp is more than 60 seconds old
3. Add audit logging:
   - Log cron invocation start/end with timestamps
   - Use console.log or insert into an audit table
4. Research Vercel cron headers (x-vercel-cron-auth-header) for additional verification.

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

### Step 6.2  JWT Shorter Expiry

| Field | Value |
|-------|-------|
| **Priority** | MEDIUM |
| **Findings** | F-11 (4hr JWT with no revocation) |
| **Dependencies** | Step 5.3 (client expiry tracking must exist first  otherwise employees get unexplained 401s) |
| **Files** | MODIFY `supabase/functions/employee-auth/index.ts` |
| **References** | JWT signing at approximately L91-113 |

**Context:** Employee JWT is valid for 4 hours with no server-side revocation. Reducing to 2 hours limits the window of exposure if a token is compromised. Step 5.3 must be deployed first so clients can warn employees before expiry.

**Deliverables:**
1. Modified `employee-auth/index.ts`:
   - Change JWT `exp` from 4 hours to 2 hours
   - Update any comments referencing the expiry duration

**Verification:**
```bash
npm run build
# Manual: Authenticate  verify JWT exp claim is ~2 hours from now
# Manual: Verify Step 5.3 expiry warning triggers correctly at T-15min
```

**Rollback:** Revert the expiry back to 4 hours.

<details>
<summary><strong>AGENT PROMPT  Step 6.2</strong></summary>

```
PERSONA: Codex (Deno Edge Functions / Security)
PROJECT: Shift Happens

TASK: Reduce employee JWT expiry from 4 hours to 2 hours

CONTEXT:
- Finding F-11: 4-hour JWT with no revocation mechanism.
- Step 5.3 added client-side expiry tracking, so employees will be warned before token expires.

INSTRUCTIONS:
1. Read `supabase/functions/employee-auth/index.ts`.
2. Find the JWT signing code (around lines 91-113).
3. Change the expiry from 4 hours (14400 seconds) to 2 hours (7200 seconds).
4. Update any comments mentioning the expiry duration.

VERIFICATION:
- npm run build (edge function build)
```

</details>

---

### Step 6.3  CSP Headers + Low-Priority Fixes

| Field | Value |
|-------|-------|
| **Priority** | LOW |
| **Findings** | FE-15 (no CSP), F-13 (is_withdrawn conflation), F-14 (FK ON DELETE) |
| **Dependencies** | None |
| **Files** | MODIFY `next.config.ts`, CREATE `src/app/sql/49_low_priority_fixes.sql` |
| **References** | `next.config.ts` (empty), `31_deny_rpc.sql` (is_withdrawn), `23_shift_swap_tables.sql:33-38` (selected_offer_id FK) |

**Deliverables:**
1. Modified `next.config.ts`:
   - Add `headers()` configuration with Content-Security-Policy
   - CSP should allow: self, Supabase domain, Vercel analytics, inline styles (Tailwind), Google Fonts (Geist)
   - Add `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
2. `49_low_priority_fixes.sql`:
   - Add `is_denied_by_manager boolean DEFAULT false` column to `shift_swap_offers` (F-13)
   - Alter `shift_swap_requests.selected_offer_id` FK to add `ON DELETE SET NULL` (F-14)

**Verification:**
```bash
npx tsc --noEmit
npm run build
# Manual: Check response headers in browser DevTools  verify CSP is present
```

**Rollback:** Revert `next.config.ts`, drop column, revert FK.

<details>
<summary><strong>AGENT PROMPT  Step 6.3</strong></summary>

```
PERSONA: Codex (Next.js Config + SQL)
PROJECT: Shift Happens
AGENTS.md: Line 16: Next.js 16, Tailwind CSS v4. Line 10: Vercel deployment.

TASK: Add CSP headers and low-priority database fixes

CONTEXT:
- Finding FE-15: No CSP headers. next.config.ts is empty.
- Finding F-13: is_withdrawn conflates manager denial and employee decline.
- Finding F-14: selected_offer_id FK defaults to NO ACTION instead of SET NULL.

INSTRUCTIONS:
1. Read `next.config.ts` (currently empty).
2. Read `src/app/layout.tsx` to identify external resources (fonts, etc.).

3. Modify `next.config.ts`:
   - Export headers() async function
   - Add Content-Security-Policy header:
     * default-src 'self'
     * script-src 'self' 'unsafe-inline' (needed for Next.js)
     * style-src 'self' 'unsafe-inline' (needed for Tailwind)
     * font-src 'self' (Geist fonts are loaded locally via next/font)
     * connect-src 'self' *.supabase.co *.supabase.in
     * img-src 'self' data: blob:
   - Add X-Frame-Options: DENY
   - Add X-Content-Type-Options: nosniff
   - Add Referrer-Policy: strict-origin-when-cross-origin

4. Create `src/app/sql/49_low_priority_fixes.sql`:
   - ALTER TABLE shift_swap_offers ADD COLUMN IF NOT EXISTS is_denied_by_manager boolean DEFAULT false;
   - ALTER TABLE shift_swap_requests DROP CONSTRAINT IF EXISTS [find the FK name]; then re-add with ON DELETE SET NULL

VERIFICATION:
- npx tsc --noEmit
- npm run build
```

</details>

---

## Success Criteria

All 21 steps are complete when:

1. [ ] **`npx tsc --noEmit` passes** after every step
2. [ ] **`npm run build` passes** after every step
3. [ ] **All 16 F-findings** from Pass 1 are addressed:
   - F-01  Step 1.4
   - F-02  Step 4.1
   - F-03  Step 4.2
   - F-04  Step 1.3
   - F-05  Step 4.3
   - F-06  Step 1.1
   - F-07  Step 1.1
   - F-08  Step 1.5
   - F-09  Step 6.1
   - F-10  Step 1.2
   - F-11  Step 6.2
   - F-12  Step 1.6
   - F-13  Step 6.3
   - F-14  Step 6.3
   - F-15  Step 4.4
   - F-16  No fix needed (INFO)
4. [ ] **All 22 FE-findings** from Pass 2 are addressed:
   - FE-01  Step 5.2
   - FE-02  Step 5.2
   - FE-03  Step 3.5
   - FE-04  Step 5.3
   - FE-05  Step 5.3
   - FE-06  Step 2.2
   - FE-07  Step 2.3
   - FE-08  Step 2.1
   - FE-09  Deferred (data-fetching library is out of scope for this pass)
   - FE-10  Step 5.4
   - FE-11  Step 5.4
   - FE-12  Addressed in Step 5.2 (reducer hydration replaces raw localStorage reads)
   - FE-13  Step 3.1
   - FE-14  Addressed in Step 5.2 (unnecessary useMemo removed during reducer rewrite)
   - FE-15  Step 6.3
   - FE-16  Deferred (pay period shared util  low priority, standalone)
   - FE-17  Addressed in Step 5.1 (useShiftActions uses shiftId from 409 directly)
   - FE-18  Addressed in Step 5.1 (standardized async/await in useShiftActions)
   - FE-19  Addressed in Step 5.1 + 5.4 (typed results + Zod validation)
   - FE-20  Accepted (no fix needed for kiosk context)
   - FE-21  Step 3.1
   - FE-22  No fix needed (INFO  timezone handling is correct)
5. [ ] **All 10 Refactor Steps** from REFACTOR_PLAN are represented:
   - Step 1  Step 2.3
   - Step 2  Step 3.1
   - Step 3  Step 3.1
   - Step 4  Step 3.2
   - Step 5  Step 3.2
   - Step 6  Step 3.3
   - Step 7  Step 3.4
   - Step 8  Step 3.5
   - Step 9  Step 5.1
   - Step 10  Step 5.2
6. [ ] **SQL migrations numbered 42-49** (no gaps, no conflicts)
7. [ ] **ClockPageClient.tsx reduced from 1,518 lines to ~250 lines**
8. [ ] **No orphaned shifts possible** (atomic RPC)
9. [ ] **No payroll rounding bugs** (CST-aware roundTo30Minutes)
10. [ ] **Error boundaries in place** for all major route segments

---

## Deferred Items (Pass 4 or Future)

| Item | Reason for Deferral |
|------|-------------------|
| FE-09 (data-fetching library  SWR/TanStack Query) | Architectural decision that affects the entire app, not just clock page. Should be a separate initiative. |
| FE-16 (pay period shared util) | Low impact, standalone change. Can be done anytime. |
| FE-20 (URL state sync) | Accepted limitation for kiosk context. |
| Server-side token revocation (F-11 extension) | Requires Redis or DB blocklist infrastructure. Out of scope for this pass. |
| Playwright E2E tests | Should be added per step but is a parallel workstream. |
| Database state machine constraints | Adding CHECK constraints for valid status transitions is beneficial but requires careful migration planning. |

---

## AGENTS.md Constraints Referenced

| Constraint | Line | Steps Affected |
|------------|------|----------------|
| "ALWAYS use RPCs for complex mutations" | 35 | 1.2, 4.3 |
| "Security definer convention" | 37 | 1.1, 1.2, 1.3, 1.5, 1.6, 4.3, 4.4 |
| "Forward-only migrations" | 38 | All SQL steps (42-49) |
| "Do not touch rounding logic without explicit instruction" | 43 | **2.2 (OVERRIDE  FE-06 is a correctness bug, this roadmap IS the instruction)** |
| "High-risk flows" | 47-51 | 1.2 (start-shift), 4.1 (end-shift) |
| "Mobile first (375px)" | 54 | 2.1, 3.1-3.5, 5.4 |
| "Explicit errors { error, code[X] }" | 56 | 1.4, 5.1 |
| Validation commands | 65-66 | Every step |

---

**End of Pass 3 Roadmap**
