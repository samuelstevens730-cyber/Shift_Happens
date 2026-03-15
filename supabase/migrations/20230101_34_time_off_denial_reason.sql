alter table public.time_off_requests
  add column if not exists denial_reason text;
