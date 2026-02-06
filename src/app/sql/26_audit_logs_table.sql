create table if not exists public.request_audit_logs (
  id uuid primary key default gen_random_uuid(),
  request_type text not null
    check (request_type in ('shift_swap', 'time_off', 'timesheet')),
  request_id uuid not null,
  action public.audit_action not null,
  actor_profile_id uuid references public.profiles(id),
  actor_auth_user_id uuid references auth.users(id),
  snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_request
  on public.request_audit_logs (request_type, request_id);

create index if not exists idx_audit_logs_created
  on public.request_audit_logs (created_at);
