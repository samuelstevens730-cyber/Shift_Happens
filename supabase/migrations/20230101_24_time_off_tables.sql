create table if not exists public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  denial_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_off_requests_date_range check (end_date >= start_date)
);

alter table public.time_off_requests
  add column if not exists store_id uuid references public.stores(id) on delete cascade;

-- NOTE: If legacy rows exist, backfill store_id before enforcing NOT NULL.

create table if not exists public.time_off_blocks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  request_id uuid references public.time_off_requests(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  constraint time_off_blocks_date_range check (end_date >= start_date)
);

create index if not exists idx_time_off_store_status
  on public.time_off_requests (store_id, status);

create index if not exists idx_time_off_profile
  on public.time_off_requests (profile_id);

create index if not exists idx_time_off_blocks_profile_dates
  on public.time_off_blocks (profile_id, start_date, end_date)
  where deleted_at is null;
