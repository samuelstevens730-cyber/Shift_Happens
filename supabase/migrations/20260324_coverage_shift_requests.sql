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

create index if not exists coverage_shift_requests_shift_date_idx
  on public.coverage_shift_requests (shift_date);
