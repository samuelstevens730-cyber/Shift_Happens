alter table public.time_off_requests
  add column if not exists updated_at timestamptz not null default now();
