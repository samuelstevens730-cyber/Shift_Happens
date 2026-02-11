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

### Database & RPCs
-   **Writes:** **ALWAYS use RPCs (Stored Procedures)** for complex mutations (Clock In, Shift Swap).
-   **RPC Params:** Accept explicit actor params (e.g., `p_actor_profile_id`) instead of relying solely on `auth.uid()` inside logic.
-   **Security:** Follow existing repo convention for `security definer`. Use `set row_security = off` where required for production behavior (e.g., bypassing RLS for specific admin actions).
-   **Migrations:** Schema truth spans `src/app/sql/` and `supabase/migrations/`. **Do not edit already-deployed migrations; add new numbered forward migrations.**

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

## 6. Known Technical Debt (Handle with Care)
-   **Service Role Usage:** Some older API routes use `supabaseAdmin` unnecessarily. Check `SECURITY_STORE_ISOLATION_AUDIT.md` before flagging these.
-   **Timezone Logic:** The `roundTo30Minutes` function historically had off-by-one-hour bugs. Verify logic when touching.

## 7. Validation Commands
*Run these to verify your work:*
-   `npx tsc --noEmit` (TypeScript Check - Must Pass)
-   `npm run build` (Build Check - Note: Sandbox/Network may fail on external font fetches; ignore those network errors, focus on build errors).

---
**End of Agent Context**