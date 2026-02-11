# Audit Phase 1: Backend Findings

> Generated: 2026-02-10 | Auditor: Claude Opus 4 | Pass 1 of 4
> Cross-referenced against: `SECURITY_STORE_ISOLATION_AUDIT.md` (2026-02-08)
> All findings below are **NEW** (not previously documented).

---

## NEW Findings Table

| # | File | Issue | Severity | Category | Recommended Fix |
|---|------|-------|----------|----------|-----------------|
| F-01 | `src/app/api/messages/[id]/dismiss/route.ts` | Missing store/shift ownership validation. Only checks `target_profile_id === auth.profileId`. No verification that the message belongs to the user's current store or shift context. | **HIGH** | Security | Add `delivered_store_id` or `delivered_shift_id` validation against auth context. |
| F-02 | `src/app/api/end-shift/route.ts:246-264` | `manualClose=true` parameter auto-inserts `shift_checklist_checks` rows for ALL missing required items. No audit trail of who triggered the override, no manager approval required. Any authenticated employee can bypass their checklist. | **HIGH** | Business Logic | Require manager-level auth for manual close, or create separate manager-approved endpoint. Log the actor who triggered the override. |
| F-03 | `src/app/api/admin/shifts/[shiftId]/route.ts:96-140` | Admin PATCH with `endedAt` auto-creates missing `shift_drawer_counts` at the store's `expected_drawer_cents` default with a generic note "Admin edit (missing count)." Silently fills in drawer data that was never actually counted. | **HIGH** | Business Logic | Require manager to provide actual count values. Store the creating manager's user_id. Consider disallowing auto-creation entirely. |
| F-04 | `supabase/functions/employee-auth/index.ts:177-191` | Fallback employee code lookup loads ALL active profiles with `employee_code IS NOT NULL` into edge function memory, then iterates in JavaScript. O(n) per auth attempt if primary ILIKE query misses. | **HIGH** | Performance | Add a functional index: `CREATE INDEX idx_profiles_employee_code_norm ON profiles(UPPER(REPLACE(employee_code,'-',''))) WHERE active=true AND employee_code IS NOT NULL`. Replace fallback with indexed query. |
| F-05 | `src/app/api/admin/users/route.ts:122-135` | Profile creation and store_memberships insertion are two separate Supabase calls. If membership insert fails, the profile is orphaned (exists with no store assignments, invisible in admin UI). | **MEDIUM** | Data Integrity | Wrap in an RPC/stored procedure with transactional guarantees, or add compensating delete on membership failure. |
| F-06 | `src/app/sql/40_clock_window_schedule_fallback.sql` | `clock_window_check()` is `SECURITY DEFINER` but does NOT include `SET search_path = public`. Vulnerable to search_path manipulation if called in a context where the path has been altered. | **MEDIUM** | Security | Add `SET search_path = public` to the function definition. |
| F-07 | `src/app/sql/27_validation_functions.sql:24-25` | `check_bilocation_conflict()` casts `(p_shift_date + p_scheduled_start)::timestamptz` without specifying timezone. Uses PostgreSQL session timezone (typically UTC on Supabase) rather than America/Chicago. Could produce incorrect conflict detection for shifts near midnight CST. | **MEDIUM** | Timezone | Use `(p_shift_date + p_scheduled_start) AT TIME ZONE 'America/Chicago'` for deterministic behavior matching the application's CST convention. |
| F-08 | `src/app/sql/30_timesheet_rpc.sql:89-184` | `approve_timesheet_change_request()` validates staleness (original vs current times) but does NOT re-check `check_payroll_lock()`. A request submitted before lock, pending through lock boundary, can be approved after lock. | **MEDIUM** | Business Logic | Add `SELECT * INTO v_lock FROM check_payroll_lock(v_shift.started_at); IF v_lock.is_locked THEN RAISE EXCEPTION 'Payroll period is locked';` before applying changes. |
| F-09 | `src/app/api/cron/*/route.ts` | Cron endpoints use simple `x-cron-secret` header comparison. No rate limiting, no replay protection (same request can be sent multiple times), no audit logging of cron invocations. | **MEDIUM** | Security | Add timestamp-based nonce or HMAC signature. Log each invocation. Consider Vercel Cron headers for built-in verification. |
| F-10 | `src/app/api/start-shift/route.ts:322-388` | Shift creation + drawer count insertion are two separate Supabase operations. On drawer count failure, the API manually DELETEs the shift. If the DELETE also fails (network, timeout), an orphaned shift exists with no drawer count. | **MEDIUM** | Data Integrity | Migrate to an RPC that atomically creates shift + drawer count in a single transaction. |
| F-11 | Employee JWT (4hr expiry) | JWT valid for 4 hours with no server-side revocation mechanism. If an employee's PIN is compromised or they're terminated, the token remains valid until natural expiry. JWT claims (`store_ids`) reflect membership at issuance, not current state. | **MEDIUM** | Security | Consider reducing to 1-2 hours. Add token blocklist in Redis or DB for immediate revocation on termination/PIN reset. |
| F-12 | `src/app/sql/28_swap_rpc.sql:32-39` | Active swap request uniqueness is enforced via `SELECT EXISTS` soft guard, not a database constraint. Under concurrent requests, two `submit_shift_swap_request` calls for the same `schedule_shift_id` could both pass the check before either inserts. | **LOW** | Data Integrity | Add partial unique index: `CREATE UNIQUE INDEX idx_swap_requests_active ON shift_swap_requests(schedule_shift_id) WHERE status IN ('open','pending')`. |
| F-13 | `src/app/sql/31_deny_rpc.sql` (shift_swap) | Manager denial sets `is_withdrawn=true` on all non-selected offers. But `decline_shift_swap_offer()` (employee action) also uses `is_withdrawn=true`. Same column conflates two different semantics: employee voluntary decline vs. manager systemic denial. | **LOW** | Business Logic | Add `is_denied_by_manager boolean DEFAULT false` column, or use the existing audit_action enum to distinguish origin. |
| F-14 | `src/app/sql/23_shift_swap_tables.sql:33-38` | `shift_swap_requests.selected_offer_id` FK to `shift_swap_offers(id)` defaults to `NO ACTION` on delete. If an offer is somehow deleted while selected, the request holds a dangling reference. | **LOW** | Schema | Add `ON DELETE SET NULL` to prevent FK violation errors. |
| F-15 | `src/app/sql/28_swap_rpc.sql:599-782` | `approve_shift_swap_or_cover()` does NOT re-check that the schedule is still `published` at approval time. If a manager unpublishes a schedule between offer selection and approval, the swap could mutate an unpublished schedule. | **LOW** | Business Logic | Add `IF v_schedule_status <> 'published' THEN RAISE EXCEPTION` check before executing the swap. |
| F-16 | `src/lib/clockWindows.ts` + `src/app/sql/40_clock_window_schedule_fallback.sql` | Both client and DB use `America/Chicago` consistently for clock window enforcement. No issue found. | **INFO** | Timezone | No fix needed. Documented for completeness. |

---

## Answers to Specific Audit Questions

### SECURITY & AUTH

#### Q1: Auth Flow (PIN -> JWT -> API) - Are there gaps?

**Flow is sound.** The chain:
1. Employee enters PIN at `/clock` page
2. `employee-auth` edge function verifies via PBKDF2 (150,000 iterations, SHA-256, timing-safe comparison)
3. ES256 JWT issued with `{profile_id, store_id, store_ids[], role: "authenticated"}`, 4-hour expiry
4. Client stores token in `sessionStorage` (tab-scoped, not persistent)
5. API routes verify via `authenticateShiftRequest()` -> ES256 public key signature verification

**Gaps identified:**
- JWT claims are static for 4 hours (store_ids, membership). If employee is removed from a store, they retain access until token expires. (Known issue - documented in security audit as Structural Risk C.)
- No server-side token revocation mechanism.
- 4-digit PIN has 10,000 combinations. Mitigated by PBKDF2 + lockout (3 attempts, 5-30min lockout), but still modest entropy.

#### Q2: Service Role Hunt - Did I miss any?

**No new undocumented service role usage found.** All 64 routes listed in `SECURITY_STORE_ISOLATION_AUDIT.md` were confirmed. The architecture deliberately uses service role for ALL API operations, bypassing RLS entirely. Security is enforced at the application layer (auth checks in every route).

Key files:
- `src/lib/supabaseServer.ts` - Creates the single service role client used everywhere
- `src/lib/adminAuth.ts` - Helper for manager auth (`getManagerStoreIds()`)

#### Q3: Do all API routes use `authenticateShiftRequest`?

**Yes for employee routes.** All employee-facing shift operation routes use `authenticateShiftRequest()`:
- `start-shift`, `end-shift`, `checklist/check-item`, `confirm-changeover`
- `messages/[id]/dismiss`, `shift/[shiftId]`, `shift/open`
- All `requests/*` routes

**Admin routes** use `supabaseServer.auth.getUser(token)` + `getManagerStoreIds()` instead (correct pattern for manager auth).

**Cron routes** use `x-cron-secret` header comparison (no JWT/auth token).

#### Q4: Any dynamic SQL injection vectors?

**None found.** All database operations use:
- Supabase SDK with parameterized `.eq()`, `.in()`, `.select()` methods
- RPC calls with typed parameters
- No string interpolation into SQL anywhere in the codebase

#### Q5: Any hardcoded secrets?

**No.** `.env.local` is in `.gitignore` (line 34: `.env*`). Never committed to git history (verified via `git log --all -- .env.local`). All secrets are loaded via `process.env` (API routes) or `Deno.env.get()` (edge functions). No hardcoded keys, tokens, or credentials in source code.

---

### DATABASE & RPCs

#### Q6: RPC Security - SECURITY DEFINER + search_path + row_security?

**Almost all correct.** Pattern for 95% of RPCs:
```sql
SECURITY DEFINER
SET search_path = public
```

**Exception:** `clock_window_check()` in file 40 is `SECURITY DEFINER` but **missing `SET search_path`**. (Finding F-06.)

**Cleaning RPCs** (file 41) add `SET row_security = off` explicitly, which is intentional per AGENTS.md convention for bypassing RLS in admin-level operations.

**Note on SECURITY DEFINER behavior:** In PostgreSQL, `SECURITY DEFINER` functions execute as the function owner (typically the migration role). When the owner is a superuser or has table access outside RLS, the function implicitly bypasses RLS without needing `SET row_security = off`. This is the correct behavior for this codebase - the RPCs handle their own authorization checks.

#### Q7: Are BEGIN/COMMIT used? Partial update risks?

**Explicit transactions:** Only `18_v2_workforce_migration.sql` uses `BEGIN/COMMIT` (wrapping the entire migration).

**Implicit transactions:** Each RPC function body executes as a single implicit transaction in PostgreSQL. If any statement raises an exception, the entire function rolls back. This is correct.

**Partial update risks exist at the API layer:**
- `start-shift/route.ts`: Creates shift, then inserts drawer count. If drawer count fails, manually DELETEs the shift (best-effort rollback, not transactional). (Finding F-10.)
- `admin/users/route.ts`: Creates profile, then inserts memberships. No rollback on membership failure. (Finding F-05.)

#### Q8: FOR UPDATE locks - Shift Swaps and Drawer Counts?

**Shift Swaps: Excellent locking.** Every mutation RPC locks the request row with `FOR UPDATE`:
- `submit_shift_swap_offer` - locks request (prevents concurrent offer + status change)
- `select_shift_swap_offer` - locks request
- `decline_shift_swap_offer` - locks request
- `approve_shift_swap_or_cover` - locks request + request_shift + offer_shift (triple lock)
- `cancel_shift_swap_request` - locks request

**Cron functions** use `FOR UPDATE SKIP LOCKED` for safe concurrent execution.

**Drawer Counts: No explicit locks, but safe.** Drawer counts use `UPSERT` with `ON CONFLICT (shift_id, count_type)` which provides implicit serialization via the unique constraint. No race condition possible for duplicate counts.

#### Q9: N+1 Queries in API routes?

**No true N+1 patterns found.** The admin shifts list route fetches drawer counts in a single batched query using `.in("shift_id", shiftIds)`. The checklist settings route similarly batches item fetches by template IDs.

**Performance concern:** The PIN auth fallback scan (Finding F-04) is not N+1 but is an O(n) full table scan - the most significant performance issue found.

#### Q10: Foreign Keys and ON DELETE behaviors?

**Generally correct.** Most FKs use `ON DELETE CASCADE` appropriately:
- `store_memberships`, `shift_drawer_counts`, `shift_checklist_checks`, `shift_swap_*`, `time_off_*`, `timesheet_*`, `cleaning_*` all cascade from parent.
- `profiles.auth_user_id` -> `auth.users(id)` uses `ON DELETE SET NULL` (correct - don't delete profile when auth user removed).
- `shifts.manual_closed_by_profile` -> `profiles(id)` uses `ON DELETE SET NULL` (correct).

**Gap:** `shift_swap_requests.selected_offer_id` FK defaults to `NO ACTION`. (Finding F-14.)

---

### BUSINESS LOGIC & DATA FLOW

#### Q11: Shift Swap - Where can data get inconsistent?

**Traced flow:** Request -> Offer -> Selection -> Approval

The swap flow is well-protected by FOR UPDATE locks at each stage. Specific consistency risks:

1. **Race on submit:** Two concurrent `submit_shift_swap_request` calls for the same schedule_shift could both pass the `SELECT EXISTS` check (soft guard). (Finding F-12.)

2. **Schedule unpublished during pending:** `approve_shift_swap_or_cover()` does not re-check schedule status. A manager could unpublish the schedule between selection and approval. (Finding F-15.)

3. **Offer semantics conflation:** Manager denial and employee decline both set `is_withdrawn=true`, making it impossible to distinguish the two in queries. (Finding F-13.)

4. **Bilocation check timing:** Conflict checks run at approval, not at offer submission. An employee could offer a shift, then get scheduled elsewhere before approval. The approval check catches this correctly, but the offerer gets a confusing error after waiting.

#### Q12: Clock-In data flow - What if DB insert fails?

**Traced flow:** `ClockPageClient.tsx` -> `POST /api/start-shift` -> DB

1. Client constructs payload: `{qrToken/storeId, profileId, shiftTypeHint, plannedStartAt, startDrawerCents, changeDrawerCents, confirmed, notifiedManager, note, force}`
2. API authenticates via `authenticateShiftRequest()`
3. Resolves store (QR token or ID), validates profile, checks membership
4. Matches against published schedule (5-minute early to 15-minute late window)
5. **INSERT into shifts** - if duplicate active shift, catches `23505` unique violation -> 409
6. **INSERT into shift_drawer_counts** - if this fails:
   - API does `supabaseServer.from("shifts").delete().eq("id", shift.id)` (manual rollback)
   - If the DELETE also fails -> **orphaned shift with no drawer count**
   - The `enforce_required_drawer_counts` trigger would prevent clock-out on this orphaned shift (can't end without counts), but the shift would exist as "active" blocking future clock-ins

**Recommendation:** Migrate to an atomic RPC for shift + drawer count creation.

#### Q13: State machines - Enforced by DB constraints?

**Partially enforced:**

| State Machine | DB Enforcement | Code Enforcement |
|---|---|---|
| Shift lifecycle (active -> ended) | `UNIQUE(profile_id) WHERE ended_at IS NULL` prevents duplicates. Trigger prevents ending without drawer counts. | API checks `ended_at IS NULL` before update. |
| Request status transitions | No CHECK constraint on valid transitions. | RPCs validate current status before mutation (e.g., must be 'open' to select offer, 'pending' to approve). |
| Drawer count types | `UNIQUE(shift_id, count_type)` prevents duplicates. | API uses upsert with conflict handling. |
| Clock windows | Trigger `trg_enforce_clock_windows` validates times. | Also checked client-side. Scheduled shifts exempt. |

**Gap:** Request status transitions are not enforced by DB constraints. If a bug in code sets an invalid transition (e.g., 'approved' -> 'open'), the DB would accept it. The enum type prevents invalid values but not invalid transitions.

#### Q14: Timezone safety in clockWindows.ts?

**Both layers are consistent:**

- **Client** (`src/lib/clockWindows.ts`): Uses `Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago'})` to convert all timestamps to CST before comparison. This is the correct approach per AGENTS.md.

- **Database** (`clock_window_check()` in file 40): Uses `p_time AT TIME ZONE 'America/Chicago'` for the same conversion.

- **Validation functions** (`check_bilocation_conflict`, `check_solo_coverage_conflict`): Cast `(date + time)::timestamptz` **without** explicit timezone. This uses the PostgreSQL session timezone (UTC on Supabase), which may differ from America/Chicago for overnight shifts. (Finding F-07.)

---

## Pass 2 Handoff: Backend Constraints for Frontend/Integration Audit

### Authentication Model
- **Managers:** Standard Supabase Auth (email/password) -> `auth.users` JWT -> verified via `supabaseServer.auth.getUser()`
- **Employees:** Custom PIN -> Edge Function -> ES256 JWT (4hr) -> verified via `jose` library in `shiftAuth.ts`
- **Cron:** Shared secret header (`x-cron-secret`)

### Write Patterns
- **All API routes use service role** (`supabaseServer`) - RLS is bypassed; security is 100% application code
- **Request workflows** (swap, time-off, timesheet) exclusively use RPCs with FOR UPDATE locks
- **Clock-in/out** uses direct Supabase insert/update (not RPC) with manual rollback on failure
- **Drawer counts** use upsert with unique constraint for idempotency

### Business Rules the Frontend Must Respect
- Clock-in requires schedule match within -5 to +15 minute window (or `force=true`)
- Drawer counts required for open/close/double (not other)
- Changeover count required for double shifts only
- Checklist completion required before clock-out (unless `manualClose=true`)
- Pending messages/tasks must be acknowledged before clock-out
- Time is always America/Chicago (CST/CDT)
- Payroll rounding: nearest 30 minutes (handled in `roundTo30Minutes()`)
- Shift duration > 13 hours triggers override requirement

### Known Limitations
- No server-side token revocation for employee JWTs
- JWT store_ids are static (no live membership re-check)
- Vercel Hobby Tier: 10-second API route timeout
- Manual close and admin drawer count auto-creation lack proper audit trails
- Cron routes have no replay protection

### Key Files for Pass 2
- `src/lib/shiftAuth.ts` - Auth verification
- `src/lib/clockWindows.ts` - Timezone handling
- `src/app/clock/ClockPageClient.tsx` - Main employee UI (1500+ lines, "God Component")
- `src/app/api/start-shift/route.ts` - Clock-in logic (412 lines)
- `src/app/api/end-shift/route.ts` - Clock-out logic (417 lines)
