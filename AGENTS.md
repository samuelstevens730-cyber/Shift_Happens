# AGENTS.md - Project Context & Directives

> **READ THIS FIRST:** This file contains the critical context, architectural constraints, and "Laws of Physics" for this codebase. Ingest this before generating code.

## 1. Project Identity
**Type:** Workforce Management (WFM) Application
**Core Function:** Employee scheduling, time tracking (Clock In/Out), shift swaps, and payroll export.
**Users:** Retail employees (mobile-first, high turnover, low-tech) and Managers (desktop/tablet).
**Deployment:** Vercel (Hobby Tier constraints apply - watch for 10s timeout on API routes).

## 2. Tech Stack (The Hard Constraints)
- **Frontend:** **Next.js 16** (App Router), **React 19**.
- **Backend:** Supabase (PostgreSQL).
- **Language:** TypeScript (Strict).
- **Styling:** Tailwind CSS v4.
- **Time:** **MANUAL CST HANDLING.** Do NOT install `moment` or `luxon`. We use custom `Intl` helpers in `src/lib/clockWindows.ts` to force America/Chicago time regardless of user device settings.

## 3. Architecture & Patterns

### Next.js 16 & React 19 Specifics (CRITICAL)
-   **Caching:** `fetch` requests are **not cached by default** in dev. Do not assume `force-cache`. Explicitly define `cache: 'force-cache'` if static data is needed.
-   **Async Params:** `params` and `searchParams` in pages/layouts are **Promises**. You must `await` them before access (e.g., `const { slug } = await params`).
-   **Server Actions:** Use `useActionState` (React 19) instead of the deprecated `useFormState`.
-   **Forms:** Use `useFormStatus` for pending states in forms.
-   **Server Components:** Default to Server Components. Use `'use client'` strictly for interactivity.

### Authentication (Hybrid Model)
1.  **Managers:** Standard Supabase Auth (Email/Password).
2.  **Employees:** Custom PIN System.
    * Flow: User enters PIN -> Edge Function (`employee-auth`) verifies -> Returns Custom JWT -> Client stores in `sessionStorage`.
    * **Rule:** Any client call to protected employee routes (checklist, changeover, start/end shift) **must** include `Authorization: Bearer <token>` header.
    * **Validation:** All Employee API routes must use the `authenticateShiftRequest` helper from `src/lib/shiftAuth.ts`.

### Admin Route Auth — Mandatory Pattern (enforced across all `/api/admin/*`)
Every admin route **must** follow this exact pattern — no exceptions, no inline alternatives:
```typescript
const token = getBearerToken(req)
if (!token) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token)
if (authErr || !user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
const managerStoreIds = await getManagerStoreIds(user.id)
if (!managerStoreIds.length) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
```
- Both helpers live in `src/lib/adminAuth.ts`. **Do not query `store_managers` inline.**
- `getManagerStoreIds` takes `user.id: string` — NOT a Request object.
- `supabaseServer` is the **service role** client — it bypasses ALL RLS. Every query using it **must** be filtered by `managerStoreIds`.
- For **mutations** (POST/PATCH/DELETE): after fetching the target record, verify `managerStoreIds.includes(record.store_id)` before proceeding. A filtered GET is not sufficient authorization for writes.
- Reference implementation: `src/app/api/admin/shifts/route.ts`

### Employee Route Auth — Mandatory Pattern (enforced across all non-admin employee routes)
```typescript
const auth = await authenticateShiftRequest(req)  // src/lib/shiftAuth.ts
if (!auth) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
```
- `auth.profileId` and `auth.storeIds` come from the JWT claims — treat as trusted but not DB-verified.
- Use `validateStoreAccess(auth, storeId)` and `validateProfileAccess(auth, profileId)` from `shiftAuth.ts` before any store/profile-scoped operation.

### Database & RPCs
-   **Writes:** **ALWAYS use RPCs (Stored Procedures)** for complex mutations (Clock In, Shift Swap).
-   **RPC Params:** Accept explicit actor params (e.g., `p_actor_profile_id`) instead of relying solely on `auth.uid()` inside logic.
-   **Security:** Follow existing repo convention for `security definer`. Use `set row_security = off` where required for production behavior (e.g., bypassing RLS for specific admin actions).
-   **Migrations:** Schema truth spans `src/app/sql/` and `supabase/migrations/`. **Do not edit already-deployed migrations; add new numbered forward migrations.**

### RLS Policy Standards — Required for Every New Table
Every new table that holds store- or employee-scoped data **must** have RLS enabled before shipping.

**Manager scope predicate** (for tables with a direct `store_id` column):
```sql
store_id IN (SELECT store_id FROM store_managers WHERE user_id = auth.uid())
```

**Manager scope via FK** (for tables that link to store through a `shift_id` FK):
```sql
EXISTS (
  SELECT 1 FROM shifts s
  JOIN store_managers sm ON sm.store_id = s.store_id
  WHERE s.id = <table>.shift_id AND sm.user_id = auth.uid()
)
```

**Employee scope predicate** (JWT claim pattern — only needed if employees query the table directly via authenticated role, not via service-role RPC):
```sql
EXISTS (
  SELECT 1 FROM shifts s
  WHERE s.id = <table>.shift_id
    AND s.profile_id::text = (current_setting('request.jwt.claims', true)::jsonb->>'profile_id')
)
```

**Clause rules:**
- `SELECT` policy → `USING` only
- `INSERT` policy → `WITH CHECK` only
- `UPDATE` policy → both `USING` (existing rows) **and** `WITH CHECK` (new row values)

**Migration must be idempotent:**
```sql
ALTER TABLE IF EXISTS public.<table> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "<name>" ON public.<table>;
CREATE POLICY "<name>" ON public.<table> FOR <cmd> TO authenticated USING (...);
```

**Rollback:** Never use `DISABLE ROW LEVEL SECURITY` as a fix — ship a forward migration that drops and recreates the bad policy.

### The "Clock Page" (Critical Component)
-   **Location:** `src/app/clock/ClockPageClient.tsx`
-   **Status:** Currently a "God Component" (1500+ lines). Active refactor target.
-   **Constraint:** Logic handles payroll rounding (nearest 30m). **Do not touch the rounding logic without explicit instruction.**

## 4. High-Risk Flows (Extra Care)
*Modify these files with extreme caution and regression checks:*
-   `src/app/api/start-shift/route.ts`
-   `src/app/api/end-shift/route.ts`
-   `src/app/api/checklist/check-item/route.ts`
-   `src/app/api/confirm-changeover/route.ts`
-   `src/app/api/requests/**` (Shift Swaps/Approvals)

## 5. Coding "Laws of Physics"
1.  **Mobile First:** If it breaks on a 375px wide screen, it is a bug.
2.  **No "Magic" ORMs:** We use Supabase query builder or raw SQL. No Prisma.
3.  **Explicit Errors:** API routes **should** return `{ error: string, code?: string }`. Frontend must handle these gracefully (no white screens).
4.  **Performance:** Avoid "Waterfalls". Use `Promise.all` for parallel data fetching.
5.  **Admin Auth is not optional:** Every `/api/admin/*` route must call `getManagerStoreIds` and filter all `supabaseServer` queries by the result. A route that authenticates but does not scope by store is a security hole.
6.  **No bare `store_managers` queries in routes:** Use `getManagerStoreIds(user.id)` from `src/lib/adminAuth.ts`. Direct inline queries against `store_managers` silently drift when the helper logic changes.
7.  **RLS is the second layer, not the only layer:** API-level store filtering and DB-level RLS must both be present on sensitive tables. Do not rely on one to cover for the absence of the other.

## 6. Known Technical Debt (Handle with Care)
-   **Service Role Usage:** Some older API routes use `supabaseAdmin` unnecessarily. Check `SECURITY_STORE_ISOLATION_AUDIT.md` before flagging these.
-   **Timezone Logic:** The `roundTo30Minutes` function historically had off-by-one-hour bugs. Verify logic when touching.
-   **Employee JWT claims are not DB-verified:** `authenticateShiftRequest()` trusts `profile_id` and `store_ids` from the ES256 JWT without a live DB cross-check. If a token is issued with stale claims, the error propagates silently. Future hardening: add a lightweight DB lookup on first request per session.
-   **Config/reference tables without RLS:** `clock_windows`, `cleaning_tasks`, `store_rollover_config`, `checklist_templates`, `checklist_items` have no RLS by design (read-only reference data). If any of these tables ever become store-scoped or writable by employees, RLS must be added before shipping.

## 7. Validation Commands
*Run these to verify your work:*
-   `npx tsc --noEmit` (TypeScript Check - Must Pass)
-   `npm run build` (Build Check - Note: Sandbox/Network may fail on external font fetches; ignore those network errors, focus on build errors).

---
**End of Agent Context**
## 8. Security Additions (2026-02)
These are additional mandatory guardrails layered on top of sections 3-7.

### API Body Parsing
- Do not use silent JSON parse fallbacks like `await req.json().catch(() => ({}))`.
- On malformed JSON, return `400` with `{ error: "Invalid JSON" }`.

### Write Authorization
- For scoped mutations (`POST/PATCH/DELETE`), fetch the target row first and verify ownership/scope before mutating.
- Admin write endpoints must enforce `managerStoreIds.includes(record.store_id)` (or equivalent FK-based store ownership check).

### Migration Safety (Production-First)
- Preflight before applying any migration:
  - `pg_class` for table + `relrowsecurity`
  - `pg_policies` for existing policies
  - `information_schema.columns` for exact column names
- Apply one migration at a time.
- Verify policy state after each apply with `pg_policies`.
- Immediately smoke test manager + employee flows.
- If a policy causes regression, ship a forward fix migration. Never disable RLS globally.

### Service Role Usage in Employee Routes
- If `supabaseServer` is used in employee-facing routes, add explicit auth + store/profile scoping checks in code.
- Add a short inline comment above the query documenting the scope enforcement.

### Public Endpoint Data Minimization
- Public health/status routes must not expose environment/config internals.
- Return minimal operational response only (e.g., `{ ok: true }`).
