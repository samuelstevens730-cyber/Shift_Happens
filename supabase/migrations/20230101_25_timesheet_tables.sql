create table if not exists public.timesheet_change_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  requested_started_at timestamptz,
  requested_ended_at timestamptz,
  original_started_at timestamptz not null,
  original_ended_at timestamptz,
  reason text not null,
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  denial_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timesheet_change_requests_requested_check
    check (requested_started_at is not null or requested_ended_at is not null)
);

create index if not exists idx_timesheet_requests_store_status
  on public.timesheet_change_requests (store_id, status);

create index if not exists idx_timesheet_requests_shift
  on public.timesheet_change_requests (shift_id);
