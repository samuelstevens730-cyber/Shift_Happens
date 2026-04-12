create table if not exists public.early_clock_in_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  schedule_shift_id uuid not null references public.schedule_shifts(id) on delete cascade,
  shift_date date not null,
  requested_planned_start_at timestamptz not null,
  scheduled_start_at timestamptz not null,
  requested_shift_type text not null check (requested_shift_type in ('open', 'close', 'double', 'other')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled')),
  manager_planned_start_at timestamptz null,
  manager_started_at timestamptz null,
  denial_reason text null,
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.early_clock_in_requests enable row level security;

drop policy if exists "early_clock_in_requests_employee_read" on public.early_clock_in_requests;
create policy "early_clock_in_requests_employee_read"
on public.early_clock_in_requests
for select
to authenticated
using (
  profile_id::text = (current_setting('request.jwt.claims', true)::jsonb->>'profile_id')
);

drop policy if exists "early_clock_in_requests_employee_insert" on public.early_clock_in_requests;
create policy "early_clock_in_requests_employee_insert"
on public.early_clock_in_requests
for insert
to authenticated
with check (
  profile_id::text = (current_setting('request.jwt.claims', true)::jsonb->>'profile_id')
);

drop policy if exists "early_clock_in_requests_manager_read" on public.early_clock_in_requests;
create policy "early_clock_in_requests_manager_read"
on public.early_clock_in_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.store_managers sm
    where sm.user_id = auth.uid()
      and sm.store_id = early_clock_in_requests.store_id
  )
);

create index if not exists early_clock_in_requests_status_idx
  on public.early_clock_in_requests (status);

create index if not exists early_clock_in_requests_store_idx
  on public.early_clock_in_requests (store_id);

create index if not exists early_clock_in_requests_profile_idx
  on public.early_clock_in_requests (profile_id);

create index if not exists early_clock_in_requests_shift_date_idx
  on public.early_clock_in_requests (shift_date);

create unique index if not exists early_clock_in_requests_pending_unique_idx
  on public.early_clock_in_requests (profile_id, schedule_shift_id)
  where status = 'pending';
