# Cross-Store Shift Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow employees to log hours worked at a different store, route those entries through manager approval, display approved entries on the employee's My Shifts time card, surface pending items in the admin Command Center, and include approved hours in payroll as a separate column that does not affect store-level reconciliation.

**Architecture:** A new `coverage_shift_requests` table stores the submission (profile, store, date, time-in HH:MM, time-out HH:MM). The server converts HH:MM wall-clock time to a real UTC `timestamptz` using `date-fns/tz` (`TZDate`) with `America/Chicago` — this handles CST/CDT automatically. Employee auth uses `authenticateShiftRequest` from `shiftAuth.ts`, which accepts both PIN JWT and Supabase tokens. Approved records are merged into the My Shifts page client-side alongside regular shifts. Admin approval is gated behind Supabase auth and scoped to the manager's assigned stores. Payroll shows `coverage_hours` as a separate column; it is never added to `total_hours` so store-level reconciliation is unaffected.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), TypeScript, Zod, `date-fns/tz`, `authenticateShiftRequest` / `createEmployeeSupabase` / `supabaseServer`, existing `bento-shell` + `HomeHeader` CSS pattern.

**Auth model:**
- Employee submit → `authenticateShiftRequest` (accepts PIN JWT or Supabase token, returns `AuthContext`)
- Admin list/approve/deny → Supabase token only, `getBearerToken` + `supabaseServer.auth.getUser`; queries scoped to `coverage_store_id IN (managerStoreIds)`
- Employee My Shifts read → `createEmployeeSupabase(pinToken)` for PIN auth (RLS enforces `profile_id`); `supabaseServer` + explicit `profile_id` filter for Supabase session auth

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `src/app/api/requests/coverage-shift/route.ts` | POST (employee submit) + GET (admin list) |
| `src/app/api/requests/coverage-shift/[id]/approve/route.ts` | POST – manager approves |
| `src/app/api/requests/coverage-shift/[id]/deny/route.ts` | POST – manager denies |
| `src/app/admin/coverage-shifts/page.tsx` | Admin review page at `/admin/coverage-shifts` |
| `src/app/coverage-shift/new/page.tsx` | Employee submission form |
| `supabase/migrations/20260324_coverage_shift_requests.sql` | Table + RLS |

### Modified files
| Path | Change |
|------|--------|
| `src/schemas/requests.ts` | Add `submitCoverageShiftSchema` |
| `src/app/dashboard/shifts/page.tsx` | Fetch approved coverage entries and merge into shift list |
| `src/app/page.tsx` | Add "Coverage Shift" to Quick Actions |
| `src/app/api/admin/dashboard/route.ts` | Add pending coverage items to action items feed, scoped to manager's stores |
| `src/app/admin/payroll/pages.tsx` | Add `Coverage` column to employee summary table |
| `src/app/api/admin/payroll/route.ts` | Fetch approved coverage records, attach as separate `coverage_hours` (NOT added to `total_hours`) |
| `src/app/admin/page.tsx` | Add Coverage Shifts tile to admin hub |

---

## Task 1 — Database Migration

**Files:**
- Create: `supabase/migrations/20260324_coverage_shift_requests.sql`

No `home_store_id` — all employees work at both stores, so it carries no meaning. Manager RLS is scoped to `coverage_store_id` matching the manager's assigned stores — this is correct even in the current two-store setup and will enforce store isolation if more stores are ever added.

- [ ] **Step 1: Write the migration SQL**

```sql
-- ============================================================
-- coverage_shift_requests
-- Idempotent forward migration
-- ============================================================

create table if not exists public.coverage_shift_requests (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles(id),
  coverage_store_id   uuid not null references public.stores(id),
  shift_date          date not null,
  time_in             timestamptz not null,
  time_out            timestamptz not null,
  notes               text,
  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'denied')),
  reviewed_by         uuid references auth.users(id),
  reviewed_at         timestamptz,
  denial_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint time_out_after_time_in check (time_out > time_in)
);

-- ── RLS ────────────────────────────────────────────────────

alter table public.coverage_shift_requests enable row level security;

-- Employee: read own rows (PIN JWT path)
drop policy if exists "coverage_shift_requests_employee_read" on public.coverage_shift_requests;
create policy "coverage_shift_requests_employee_read"
on public.coverage_shift_requests
for select
using (
  (coalesce(
    nullif(current_setting('request.jwt.claims', true), ''), '{}'
  )::json->>'profile_id')::uuid = profile_id
);

-- Employee: insert own rows (PIN JWT path)
drop policy if exists "coverage_shift_requests_employee_insert" on public.coverage_shift_requests;
create policy "coverage_shift_requests_employee_insert"
on public.coverage_shift_requests
for insert
with check (
  (coalesce(
    nullif(current_setting('request.jwt.claims', true), ''), '{}'
  )::json->>'profile_id')::uuid = profile_id
);

-- Manager: read rows for stores they manage (Supabase auth path)
-- Scoped to coverage_store_id — enforces store isolation now and future.
drop policy if exists "coverage_shift_requests_manager_read" on public.coverage_shift_requests;
create policy "coverage_shift_requests_manager_read"
on public.coverage_shift_requests
for select
using (
  exists (
    select 1
    from public.store_managers mm
    where mm.user_id = auth.uid()
      and mm.store_id = coverage_shift_requests.coverage_store_id
  )
);

-- Manager: update (approve/deny) — server-side only via service role,
-- so no RLS update policy needed. The API routes use supabaseServer
-- which bypasses RLS. This is intentional and matches existing patterns
-- (e.g. timesheet_change_requests approval).

-- ── Indexes ─────────────────────────────────────────────────

create index if not exists coverage_shift_requests_status_idx
  on public.coverage_shift_requests (status)
  where status = 'pending';

create index if not exists coverage_shift_requests_profile_idx
  on public.coverage_shift_requests (profile_id);

create index if not exists coverage_shift_requests_store_idx
  on public.coverage_shift_requests (coverage_store_id);

create index if not exists coverage_shift_requests_date_idx
  on public.coverage_shift_requests (shift_date);
```

- [ ] **Step 2: Apply migration**

Paste into Supabase SQL editor and run. Or:
```bash
supabase db push
```

- [ ] **Step 3: Verify**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'coverage_shift_requests'
order by ordinal_position;
```

Expected: 13 columns — id, profile_id, coverage_store_id, shift_date, time_in, time_out, notes, status, reviewed_by, reviewed_at, denial_reason, created_at, updated_at.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260324_coverage_shift_requests.sql
git commit -m "feat: add coverage_shift_requests table and RLS"
```

---

## Task 2 — Zod Schema

**Files:**
- Modify: `src/schemas/requests.ts`

The client sends plain `HH:MM` strings (not ISO offset strings). The server is responsible for converting to UTC `timestamptz`. The Zod schema validates only the shape of the incoming payload — the time-order check happens on the server after conversion.

- [ ] **Step 1: Add schema at the bottom of the file**

```typescript
export const submitCoverageShiftSchema = z.object({
  coverageStoreId: z.string().uuid(),
  shiftDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  timeIn:          z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  timeOut:         z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  notes:           z.string().trim().max(500).optional().nullable(),
});

export type SubmitCoverageShiftInput = z.infer<typeof submitCoverageShiftSchema>;
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/schemas/requests.ts
git commit -m "feat: add Zod schema for coverage shift submission"
```

---

## Task 3 — Employee Submit API

**Files:**
- Create: `src/app/api/requests/coverage-shift/route.ts`

Uses `authenticateShiftRequest` from `shiftAuth.ts` — this handles both PIN JWT (employees) and Supabase token (managers acting as employees). It returns an `AuthContext` with `profileId` pre-resolved.

The client sends `shiftDate` (YYYY-MM-DD) + `timeIn`/`timeOut` (HH:MM). The server converts them to UTC `timestamptz` using `TZDate` from `date-fns/tz`, which automatically selects the correct CST (`-06:00`) or CDT (`-05:00`) offset for the given date.

- [ ] **Step 1: Write the POST route**

```typescript
// src/app/api/requests/coverage-shift/route.ts
import { NextResponse } from "next/server";
import { TZDate } from "date-fns/tz";
import { supabaseServer } from "@/lib/supabaseServer";
import { authenticateShiftRequest } from "@/lib/shiftAuth";
import { submitCoverageShiftSchema } from "@/schemas/requests";

const CHICAGO = "America/Chicago";

/**
 * Convert a Chicago wall-clock date+time to a UTC ISO string.
 * TZDate interprets constructor arguments as local time in the given timezone,
 * so DST is handled automatically (CST = -06:00, CDT = -05:00).
 */
function chicagoToUtcIso(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi]   = time.split(":").map(Number);
  const zoned = new TZDate(y, m - 1, d, h, mi, 0, CHICAGO);
  return new Date(zoned.getTime()).toISOString();
}

export async function POST(req: Request) {
  const authResult = await authenticateShiftRequest(req);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const { profileId } = authResult.auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = submitCoverageShiftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.format() }, { status: 400 });
  }

  const { coverageStoreId, shiftDate, timeIn, timeOut, notes } = parsed.data;

  // Convert Chicago wall-clock times to UTC instants
  const timeInUtc  = chicagoToUtcIso(shiftDate, timeIn);
  const timeOutUtc = chicagoToUtcIso(shiftDate, timeOut);

  if (new Date(timeOutUtc) <= new Date(timeInUtc)) {
    return NextResponse.json({ error: "Time out must be after time in" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("coverage_shift_requests")
    .insert({
      profile_id:        profileId,
      coverage_store_id: coverageStoreId,
      shift_date:        shiftDate,
      time_in:           timeInUtc,
      time_out:          timeOutUtc,
      notes:             notes ?? null,
      status:            "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.error("Coverage shift insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requestId: data.id }, { status: 201 });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke test**

Start dev server. With a valid employee PIN token:
```bash
curl -X POST http://localhost:3000/api/requests/coverage-shift \
  -H "Authorization: Bearer <PIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "coverageStoreId": "<store_uuid>",
    "shiftDate": "2026-03-24",
    "timeIn": "09:00",
    "timeOut": "17:00"
  }'
# Expected 201: { "requestId": "<uuid>" }
```

Verify row appears in Supabase with `status = 'pending'`. Confirm `time_in` is stored as UTC (e.g. `2026-03-24T14:00:00Z` for 09:00 CDT).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/requests/coverage-shift/route.ts
git commit -m "feat: employee coverage shift submit API"
```

---

## Task 4 — Admin Approve/Deny APIs + GET

**Files:**
- Create: `src/app/api/requests/coverage-shift/[id]/approve/route.ts`
- Create: `src/app/api/requests/coverage-shift/[id]/deny/route.ts`
- Modify: `src/app/api/requests/coverage-shift/route.ts` (add GET handler)

All three admin routes use Supabase auth only (`getBearerToken` + `supabaseServer.auth.getUser`). **Store scope is enforced**: the manager must manage the `coverage_store_id` of the request. Uses `supabaseServer` which bypasses RLS (service role).

- [ ] **Step 1: Write approve route**

```typescript
// src/app/api/requests/coverage-shift/[id]/approve/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: request, error: fetchErr } = await supabaseServer
    .from("coverage_shift_requests")
    .select("id, status, coverage_store_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Enforce store isolation: manager must manage the coverage store
  if (!managerStoreIds.includes(request.coverage_store_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.status !== "pending") {
    return NextResponse.json({ error: "Request already resolved" }, { status: 409 });
  }

  const { error: updateErr } = await supabaseServer
    .from("coverage_shift_requests")
    .update({
      status:      "approved",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) {
    console.error("Coverage shift approve error:", updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write deny route**

```typescript
// src/app/api/requests/coverage-shift/[id]/deny/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: request, error: fetchErr } = await supabaseServer
    .from("coverage_shift_requests")
    .select("id, status, coverage_store_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Enforce store isolation: manager must manage the coverage store
  if (!managerStoreIds.includes(request.coverage_store_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.status !== "pending") {
    return NextResponse.json({ error: "Request already resolved" }, { status: 409 });
  }

  // Parse denial reason — explicit 400 on malformed JSON
  let denialReason: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    denialReason = typeof (body as Record<string, unknown>).denialReason === "string"
      ? ((body as Record<string, unknown>).denialReason as string).trim() || null
      : null;
  }

  const { error: updateErr } = await supabaseServer
    .from("coverage_shift_requests")
    .update({
      status:        "denied",
      reviewed_by:   user.id,
      reviewed_at:   new Date().toISOString(),
      denial_reason: denialReason,
      updated_at:    new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) {
    console.error("Coverage shift deny error:", updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Add GET handler to `route.ts` (admin list)**

Add these imports to the top of `src/app/api/requests/coverage-shift/route.ts`:
```typescript
import { getBearerToken, getManagerStoreIds } from "@/lib/adminAuth";
```

Then append the GET handler:

```typescript
export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseServer.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const managerStoreIds = await getManagerStoreIds(user.id);
  if (managerStoreIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabaseServer
    .from("coverage_shift_requests")
    .select(`
      id, shift_date, time_in, time_out, notes, status, denial_reason, created_at,
      profiles ( name ),
      coverage_store:stores ( name )
    `)
    .in("coverage_store_id", managerStoreIds)   // store-scoped
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Coverage shift list error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}
```

> **Note on the FK alias:** `coverage_store:stores` uses the table name since there's only one FK to `stores`. If Supabase complains about ambiguity after migration, use the FK constraint name instead: `stores!coverage_shift_requests_coverage_store_id_fkey`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/requests/coverage-shift/
git commit -m "feat: admin coverage shift approve/deny/list APIs"
```

---

## Task 5 — Command Center Action Items

**Files:**
- Modify: `src/app/api/admin/dashboard/route.ts`

Find the block that builds the `actionItems` array (look for the `shift_swap_requests` query). Add a coverage query immediately after. The query must be scoped to `coverage_store_id IN managerStoreIds` — identical to the GET handler in Task 4 — so managers only see requests for their stores.

Before writing: open `src/app/api/admin/dashboard/route.ts` and find where `managerStoreIds` is already resolved. Use that same variable.

- [ ] **Step 1: Add the query and push to action items**

```typescript
// After existing swap/timeoff/timesheet queries:
const { data: coveragePending } = await supabaseServer
  .from("coverage_shift_requests")
  .select(`
    id,
    shift_date,
    created_at,
    profiles ( name ),
    coverage_store:stores ( name )
  `)
  .eq("status", "pending")
  .in("coverage_store_id", managerStoreIds)   // store-scoped
  .order("created_at", { ascending: true })
  .limit(10);

for (const row of coveragePending ?? []) {
  actionItems.push({
    id:          `approval-coverage-${row.id}`,
    category:    "approvals" as const,
    severity:    "medium" as const,
    title:       `Coverage shift — ${(row.profiles as { name: string } | null)?.name ?? "Unknown"}`,
    description: `At ${(row.coverage_store as { name: string } | null)?.name ?? "?"} on ${row.shift_date}`,
    store_id:    null,
    created_at:  row.created_at,
  });
}
```

- [ ] **Step 2: Verify dashboard loads without error**

Open `/admin` in dev, confirm coverage items appear in the approvals section when pending records exist.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/dashboard/route.ts
git commit -m "feat: surface pending coverage shifts in Command Center"
```

---

## Task 6 — Admin Coverage Shifts Page

**Files:**
- Create: `src/app/admin/coverage-shifts/page.tsx`
- Modify: `src/app/admin/page.tsx`

Mirrors the pattern of `src/app/admin/requests/page.tsx`. Gated behind Supabase auth (the `ClientHeader` and admin route guard handle this — no extra auth check needed in the page itself beyond what the fetch returns).

- [ ] **Step 1: Write the page**

```typescript
// src/app/admin/coverage-shifts/page.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type CoverageRequest = {
  id: string;
  shift_date: string;
  time_in: string;
  time_out: string;
  notes: string | null;
  status: "pending" | "approved" | "denied";
  denial_reason: string | null;
  created_at: string;
  profiles: { name: string } | null;
  coverage_store: { name: string } | null;
};

export default function CoverageShiftsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<CoverageRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [pageError, setPageError]     = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }

    const res = await fetch("/api/requests/coverage-shift", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    if (!res.ok) { setPageError(json.error ?? "Failed to load"); setLoading(false); return; }
    setRequests(json.requests ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(
    id: string,
    action: "approve" | "deny",
    denialReason?: string
  ) {
    setActionError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }

    const res = await fetch(`/api/requests/coverage-shift/${id}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: action === "deny" ? JSON.stringify({ denialReason: denialReason ?? null }) : "{}",
    });
    const json = await res.json();
    if (!res.ok) { setActionError(json.error ?? "Action failed"); return; }
    await load();
  }

  const pending  = requests.filter(r => r.status === "pending");
  const resolved = requests.filter(r => r.status !== "pending");

  return (
    <div className="app-shell">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Coverage Shift Requests</h1>
          <button className="btn-secondary px-3 py-1.5" onClick={() => router.push("/admin")}>
            ← Back
          </button>
        </div>

        {pageError   && <div className="banner banner-error">{pageError}</div>}
        {actionError && <div className="banner banner-error">{actionError}</div>}
        {loading     && <div className="text-sm muted">Loading…</div>}

        {!loading && pending.length === 0 && (
          <div className="card card-pad text-sm muted">No pending coverage requests.</div>
        )}

        <div className="space-y-3">
          {pending.map(r => (
            <CoverageCard key={r.id} request={r} onAction={handleAction} />
          ))}
        </div>

        {resolved.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm muted py-2">
              {resolved.length} resolved request{resolved.length !== 1 ? "s" : ""}
            </summary>
            <div className="mt-2 space-y-2">
              {resolved.map(r => (
                <CoverageCard key={r.id} request={r} onAction={handleAction} readOnly />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function CoverageCard({
  request: r,
  onAction,
  readOnly = false,
}: {
  request: CoverageRequest;
  onAction: (id: string, action: "approve" | "deny", reason?: string) => void;
  readOnly?: boolean;
}) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason]   = useState("");

  const timeIn  = new Date(r.time_in).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit",
  });
  const timeOut = new Date(r.time_out).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit",
  });
  const hours = (
    (new Date(r.time_out).getTime() - new Date(r.time_in).getTime()) / 3_600_000
  ).toFixed(1);

  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="font-semibold">{r.profiles?.name ?? "Unknown"}</div>
          <div className="text-sm muted">
            {r.shift_date} · {timeIn}–{timeOut} ({hours} hrs)
          </div>
          <div className="text-sm muted">
            Coverage @ {r.coverage_store?.name ?? "Unknown store"}
          </div>
          {r.notes && (
            <div className="text-sm mt-1 italic text-white/60">{r.notes}</div>
          )}
          {r.status === "denied" && r.denial_reason && (
            <div className="text-sm text-red-400 mt-1">Denied: {r.denial_reason}</div>
          )}
        </div>
        <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 ${
          r.status === "approved" ? "bg-emerald-500/20 text-emerald-300"
          : r.status === "denied"  ? "bg-red-500/20 text-red-300"
          : "bg-amber-500/20 text-amber-200"
        }`}>
          {r.status}
        </span>
      </div>

      {!readOnly && r.status === "pending" && !denying && (
        <div className="flex gap-2">
          <button
            className="btn-primary px-3 py-1.5"
            onClick={() => onAction(r.id, "approve")}
          >
            Approve
          </button>
          <button
            className="btn-secondary px-3 py-1.5"
            onClick={() => setDenying(true)}
          >
            Deny
          </button>
        </div>
      )}

      {denying && (
        <div className="space-y-2">
          <input
            className="input w-full"
            placeholder="Reason for denial (optional)"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="btn-secondary px-3 py-1.5"
              onClick={() => { onAction(r.id, "deny", reason); setDenying(false); }}
            >
              Confirm Deny
            </button>
            <button
              className="btn-secondary px-3 py-1.5"
              onClick={() => { setDenying(false); setReason(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add tile to admin hub**

In `src/app/admin/page.tsx`, find the tile grid and add a tile:
```typescript
{ href: "/admin/coverage-shifts", label: "Coverage Shifts", description: "Approve cross-store hours" }
```
(Mirror the exact shape of existing tiles on that page.)

- [ ] **Step 3: Verify page loads, approve/deny work**

1. Create a test pending row directly in Supabase
2. Open `/admin/coverage-shifts`
3. Approve it — row should disappear from pending, appear in resolved
4. Refresh `/admin` — confirm the action item is gone

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/coverage-shifts/page.tsx src/app/admin/page.tsx
git commit -m "feat: admin coverage shifts review page"
```

---

## Task 7 — Employee Submission Form

**Files:**
- Create: `src/app/coverage-shift/new/page.tsx`
- Modify: `src/app/page.tsx`

Mirrors `src/app/reviews/page.tsx` for the page shell (`bento-shell` + `HomeHeader`). The form collects date + HH:MM times and sends them to the API as plain strings — the server handles timezone conversion.

- [ ] **Step 1: Write the submission page**

```typescript
// src/app/coverage-shift/new/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import HomeHeader from "@/components/HomeHeader";

const PIN_TOKEN_KEY    = "sh_pin_token";
const PIN_PROFILE_KEY  = "sh_pin_profile_id";

type Store = { id: string; name: string };

function todayCst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export default function CoverageShiftNewPage() {
  const router = useRouter();

  const [authToken, setAuthToken]         = useState<string | null>(null);
  const [isManager, setIsManager]         = useState(false);
  const [navProfileId, setNavProfileId]   = useState<string | null>(null);
  const [stores, setStores]               = useState<Store[]>([]);

  const [shiftDate, setShiftDate]             = useState(() => todayCst());
  const [coverageStoreId, setCoverageStoreId] = useState("");
  const [timeIn, setTimeIn]                   = useState("09:00");
  const [timeOut, setTimeOut]                 = useState("17:00");
  const [notes, setNotes]                     = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]       = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const pinToken = sessionStorage.getItem(PIN_TOKEN_KEY);
      const { data: { session } } = await supabase.auth.getSession();

      if (pinToken) {
        setAuthToken(pinToken);
        setNavProfileId(sessionStorage.getItem(PIN_PROFILE_KEY));
      } else if (session) {
        setAuthToken(session.access_token);
        setIsManager(true);
        const res = await fetch("/api/me/profile", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const d = await res.json();
          if (d?.profileId) setNavProfileId(d.profileId);
        }
      } else {
        router.replace("/clock");
        return;
      }

      const { data: storeData } = await supabase
        .from("stores")
        .select("id, name")
        .order("name", { ascending: true });
      setStores(storeData ?? []);
      if (storeData?.[0]) setCoverageStoreId(storeData[0].id);
    }
    init();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!coverageStoreId) {
      setFormError("Please select a store.");
      return;
    }

    // Simple client-side guard — server will enforce the real check after timezone conversion
    if (timeOut <= timeIn) {
      setFormError("Time out must be after time in.");
      return;
    }

    setSubmitting(true);
    // Send plain strings — server converts to UTC using America/Chicago timezone
    const res = await fetch("/api/requests/coverage-shift", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coverageStoreId,
        shiftDate,
        timeIn,
        timeOut,
        notes: notes.trim() || null,
      }),
    });

    const json = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setFormError(json.error ?? "Submission failed. Please try again.");
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <div className="bento-shell">
        <HomeHeader isManager={isManager} isAuthenticated profileId={navProfileId} />
        <main className="mx-auto max-w-lg px-4 pt-6 space-y-4">
          <div className="clock-page-intro-card">
            <h2 className="clock-page-intro-title">Submitted</h2>
            <p className="clock-page-intro-desc">
              Your coverage shift has been submitted and is pending manager approval.
              It will appear on your timecard once approved.
            </p>
          </div>
          <button className="btn-primary px-4 py-2" onClick={() => router.push("/")}>
            Back Home
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="bento-shell">
      <HomeHeader isManager={isManager} isAuthenticated profileId={navProfileId} />
      <main className="mx-auto max-w-lg px-4 pt-6 space-y-4">
        <div className="clock-page-intro-card">
          <h2 className="clock-page-intro-title">Coverage Shift</h2>
          <p className="clock-page-intro-desc">
            Log hours worked at another store. A manager will review and approve.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card card-pad space-y-4">
          <label className="block text-sm">
            Date
            <input
              type="date"
              className="input mt-1"
              value={shiftDate}
              max={todayCst()}
              onChange={e => setShiftDate(e.target.value)}
              required
            />
          </label>

          <label className="block text-sm">
            Store
            <select
              className="select mt-1"
              value={coverageStoreId}
              onChange={e => setCoverageStoreId(e.target.value)}
              required
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Time In
              <input
                type="time"
                className="input mt-1"
                value={timeIn}
                onChange={e => setTimeIn(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              Time Out
              <input
                type="time"
                className="input mt-1"
                value={timeOut}
                onChange={e => setTimeOut(e.target.value)}
                required
              />
            </label>
          </div>

          <label className="block text-sm">
            Notes <span className="muted">(optional)</span>
            <textarea
              className="input mt-1 h-20 resize-none"
              maxLength={500}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. covered for sick call"
            />
          </label>

          {formError && <div className="banner banner-error text-sm">{formError}</div>}

          <button
            type="submit"
            className="btn-primary px-4 py-2 w-full"
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit Coverage Shift"}
          </button>
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Add to Quick Actions on home page**

In `src/app/page.tsx`, find the `immediateActions` array and add:
```typescript
{ href: "/coverage-shift/new", label: "Coverage Shift", detail: "Log hours at another store", enabled: true },
```

- [ ] **Step 3: Test employee flow end-to-end**

1. Log in as employee (PIN auth)
2. Tap Coverage Shift in Quick Actions
3. Fill in the form and submit
4. Confirm success screen appears
5. Check Supabase — row should exist with `status = 'pending'` and `time_in`/`time_out` stored as UTC

- [ ] **Step 4: Commit**

```bash
git add src/app/coverage-shift/ src/app/page.tsx
git commit -m "feat: employee coverage shift submission form"
```

---

## Task 8 — My Shifts: Show Approved Coverage Entries

**Files:**
- Modify: `src/app/dashboard/shifts/page.tsx`

Before starting: read `src/app/dashboard/shifts/page.tsx` to confirm:
1. The exact variable name used for the PIN token (e.g. `pinToken`)
2. Whether the page uses a Supabase `session` variable for manager auth
3. The exact shape of the existing shift row type

The My Shifts page uses `createEmployeeSupabase(pinToken)` for PIN auth or `supabase` for manager auth. Add a parallel query for approved `coverage_shift_requests` and merge the results with a `isCoverage: true` flag so they render with a "Coverage" badge.

**Auth pattern for the coverage query — matches the existing page exactly:**

The real page (`src/app/dashboard/shifts/page.tsx`) uses a `"manager"` string sentinel:
```
pinToken === "manager"  →  Supabase session auth; profile stored in managerProfileId
pinToken = <jwt string>  →  Employee PIN auth; profile stored in profileId
```
The coverage query must follow this same branching. Do not invent a different pattern.

- [ ] **Step 1: Add a `CoverageRow` type and state**

```typescript
type CoverageRow = {
  id: string;
  coverage_store_id: string;
  shift_date: string;
  time_in: string;
  time_out: string;
  notes: string | null;
  stores?: { name: string } | null;
};
```

Add state: `const [coverageShifts, setCoverageShifts] = useState<CoverageRow[]>([]);`

- [ ] **Step 2: Fetch approved coverage entries alongside regular shifts**

Inside the existing `useEffect` that fetches shifts, after the `shifts` query resolves, add:

```typescript
// Fetch approved coverage shifts for this employee.
// Mirror the EXACT same branching the shifts query above uses:
//   pinToken === "manager"  →  Supabase session; use regular `supabase` client + explicit profile_id filter
//   pinToken = <jwt string> →  Employee PIN auth; use createEmployeeSupabase, RLS enforces profile_id
let coverageData: CoverageRow[] = [];
if (pinToken === "manager") {
  // Manager Supabase session — `supabase` uses the logged-in session.
  // RLS manager_read policy is store-scoped, so add an explicit profile filter to show only
  // this manager's own coverage shifts (not the whole store's).
  const { data } = await supabase
    .from("coverage_shift_requests")
    .select("id, coverage_store_id, shift_date, time_in, time_out, notes, stores:coverage_store_id(name)")
    .eq("profile_id", managerProfileId)   // same variable the shifts query uses above
    .eq("status", "approved")
    .order("time_in", { ascending: false });
  coverageData = (data ?? []) as CoverageRow[];
} else {
  // Employee PIN auth — createEmployeeSupabase embeds the PIN JWT.
  // RLS employee_read policy uses jwt.claims.profile_id, so no explicit filter needed.
  const client = createEmployeeSupabase(pinToken!);
  const { data } = await client
    .from("coverage_shift_requests")
    .select("id, coverage_store_id, shift_date, time_in, time_out, notes, stores:coverage_store_id(name)")
    .eq("status", "approved")
    .order("time_in", { ascending: false });
  coverageData = (data ?? []) as CoverageRow[];
}
setCoverageShifts(coverageData);
```

> **Supabase join note:** `stores:coverage_store_id(name)` uses the column name as the FK hint. If Supabase returns an error about ambiguous FK, use the constraint name: `stores!coverage_shift_requests_coverage_store_id_fkey(name)`.

- [ ] **Step 3: Merge into a unified display list**

```typescript
type DisplayEntry =
  | (ShiftRow & { isCoverage: false })
  | (CoverageRow & { isCoverage: true });

const allEntries = useMemo((): DisplayEntry[] => {
  const regular  = shifts.map(s => ({ ...s, isCoverage: false as const }));
  const coverage = coverageShifts.map(c => ({ ...c, isCoverage: true as const }));
  return [...regular, ...coverage].sort((a, b) => {
    const aTime = a.isCoverage ? a.time_in : (a.planned_start_at ?? a.started_at);
    const bTime = b.isCoverage ? b.time_in : (b.planned_start_at ?? b.started_at);
    return new Date(bTime).getTime() - new Date(aTime).getTime(); // newest first
  });
}, [shifts, coverageShifts]);
```

Update `filteredShifts` and `periodTotals` to use `allEntries` instead of `shifts`.

- [ ] **Step 4: Render coverage entries with a badge**

In the JSX where shift rows are rendered, handle the `isCoverage` case:

```tsx
{entry.isCoverage ? (
  <div className="card card-pad space-y-1">
    <div className="flex items-center gap-2">
      <span className="text-xs rounded-full px-2 py-0.5 bg-blue-500/20 text-blue-300 font-semibold">
        Coverage
      </span>
      <span className="text-sm font-medium">{entry.stores?.name ?? "Other store"}</span>
    </div>
    <div className="text-sm muted">{entry.shift_date}</div>
    <div className="text-sm muted">
      {new Date(entry.time_in).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}
      {" – "}
      {new Date(entry.time_out).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}
      {" · "}
      {((new Date(entry.time_out).getTime() - new Date(entry.time_in).getTime()) / 3_600_000).toFixed(1)} hrs
    </div>
    {entry.notes && <div className="text-xs muted italic">{entry.notes}</div>}
  </div>
) : (
  // existing ShiftRow render unchanged
)}
```

- [ ] **Step 5: Include coverage hours in period totals (display only)**

In `periodTotals`, extend the `useMemo` to also sum coverage hours. Note: this is for the employee's personal total displayed on their timecard — it does not feed payroll reconciliation.

```typescript
coverageShifts.forEach(c => {
  const start = new Date(c.time_in);
  const end   = new Date(c.time_out);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  const key   = getPayPeriodKey(new Date(c.time_in));
  totals.set(key, (totals.get(key) ?? 0) + hours);
});
```

- [ ] **Step 6: Test**

1. Approve a coverage shift in `/admin/coverage-shifts`
2. Log in as that employee
3. Open My Shifts — the approved entry should appear with a "Coverage" badge
4. Pay period total should include those hours

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/shifts/page.tsx
git commit -m "feat: show approved coverage shifts on employee My Shifts timecard"
```

---

## Task 9 — Payroll Integration

**Files:**
- Modify: `src/app/api/admin/payroll/route.ts`
- Modify: `src/app/admin/payroll/pages.tsx`

**Critical rule:** Coverage hours must NOT be added to `total_hours`. Store-level payroll reconciliation compares `total_hours` (regular worked + scheduled) against the number of hours the store was open. Coverage shifts happened at a different store — adding them here would make the reconciliation appear incorrect. Coverage hours are displayed in a separate column for pay calculation only.

Before modifying: open `src/app/api/admin/payroll/route.ts` and confirm:
- Exact query param names for the date range (`url.searchParams.get(...)`)
- The variable name for the employee summary array (`byEmployee` or similar)
- The hours rounding utility name (e.g. `roundPayrollHours`)

- [ ] **Step 1: Add coverage query to payroll API**

After the main shifts query and before the response is built:

```typescript
// Fetch approved coverage shifts for this pay period
const { data: coverageRows } = await supabaseServer
  .from("coverage_shift_requests")
  .select("profile_id, time_in, time_out")
  .eq("status", "approved")
  .gte("shift_date", fromDate)   // use the same variable names as the shifts query above
  .lte("shift_date", toDate);

// Build profileId → coverage hours map using the same rounding logic as regular shifts
const coverageByProfile: Record<string, number> = {};
for (const row of coverageRows ?? []) {
  const mins = (new Date(row.time_out).getTime() - new Date(row.time_in).getTime()) / 60_000;
  const hrs  = roundPayrollHours(mins); // replace with the actual rounding function name in this file
  coverageByProfile[row.profile_id] = (coverageByProfile[row.profile_id] ?? 0) + hrs;
}

// Attach as a SEPARATE field — do NOT add to total_hours
// total_hours is used for store reconciliation (store hours open = total scheduled at store)
// Coverage hours are at a different store and must not affect this store's reconciliation
for (const emp of byEmployee) {
  emp.coverage_hours = coverageByProfile[emp.user_id] ?? 0;
  // emp.total_hours is intentionally NOT modified
}
```

Also update the TypeScript type for the employee summary row:
```typescript
coverage_hours?: number;
```

- [ ] **Step 2: Add column to payroll page table**

Target format per employee row: `Worked | Coverage | Remaining | Total`

Where:
- **Worked** = hours already clocked at this store this period
- **Coverage** = approved hours worked at another store (separate, does not affect reconciliation)
- **Remaining** = scheduled but not yet worked hours at this store
- **Total** = Worked + Remaining (this is what reconciliation compares against store open hours)

In `src/app/admin/payroll/pages.tsx`:
- Add `<th>Coverage</th>` header cell after the existing "Worked" column
- Add `<td>{(emp.coverage_hours ?? 0).toFixed(1)}</td>` in each employee row
- Add a totals-row cell: `<td>{byEmployee.reduce((s, e) => s + (e.coverage_hours ?? 0), 0).toFixed(1)}</td>`
- Confirm the "Total" column header/cells still reflect Worked + Remaining only (not Coverage)

- [ ] **Step 3: Verify end-to-end**

1. Have an approved coverage shift in the target pay period
2. Open payroll for that period
3. Confirm the `Coverage` column shows the correct hours
4. Confirm `Total` column does NOT include coverage hours
5. Verify employees with no coverage show `0.0`
6. Open the Supabase table and confirm the reconciliation math (store hours open = Total) still holds

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/payroll/route.ts src/app/admin/payroll/pages.tsx
git commit -m "feat: add separate coverage hours column to payroll (no reconciliation impact)"
```

---

## Sequence Summary

```
Task 1 → DB migration          (prerequisite for everything)
Task 2 → Zod schema            (prerequisite for Task 3)
Task 3 → Employee submit API   (prerequisite for Tasks 7, 8)
Task 4 → Admin approve/deny    (prerequisite for Tasks 6, 8)
Task 5 → Command Center        (can run parallel with Task 6)
Task 6 → Admin review page     (can run parallel with Task 5)
Task 7 → Employee submit form  (depends on Task 3)
Task 8 → My Shifts display     (depends on Tasks 1, 3, 4)
Task 9 → Payroll integration   (depends on Tasks 1, 4)
```

---

## Resolved Issues (from Codex reviews)

| Issue | Resolution |
|-------|-----------|
| Manager RLS allows any manager to see any store's requests | RLS manager read policy now requires `mm.store_id = coverage_shift_requests.coverage_store_id` |
| Admin GET/approve/deny don't scope by `coverage_store_id` | All three routes now check `coverage_store_id IN managerStoreIds` after fetching the row |
| Command Center fetches all pending rows regardless of store | Query now includes `.in("coverage_store_id", managerStoreIds)` |
| Task 8 auth branch didn't match actual page sentinel | Fixed to mirror the real page: `pinToken === "manager"` → Supabase session, uses `supabase` client + `.eq("profile_id", managerProfileId)`; else → PIN JWT, uses `createEmployeeSupabase(pinToken!)` |
| `req.json().catch(() => null)` used as default template | Replaced with explicit `try { body = await req.json() } catch { return 400 }` in all route examples (POST and deny routes) |
| Timezone: fixed `-06:00` offset breaks during CDT months | Client sends plain `HH:MM`; server uses `TZDate` from `date-fns/tz` to resolve correct Chicago offset for the given date |
| Coverage hours added to `total_hours` — breaks reconciliation | Coverage hours attached as separate `coverage_hours` field; `total_hours` is never modified; payroll displays a dedicated `Coverage` column |
| `home_store_id` assumed but does not exist | Removed entirely — employees work both stores |
| Auth used `getBearerToken` + `supabaseServer.auth.getUser` for employee routes — returns null for PIN tokens | Employee submit route uses `authenticateShiftRequest` from `shiftAuth.ts` |
