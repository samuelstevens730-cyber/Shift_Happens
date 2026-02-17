-- Audit trail for admin shift edits/deletes/hard deletes.

create table if not exists public.shift_change_audit_logs (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references public.shifts(id) on delete set null,
  store_id uuid not null references public.stores(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('edit', 'soft_delete', 'hard_delete')),
  reason text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_change_audit_logs_shift_created
  on public.shift_change_audit_logs (shift_id, created_at desc);

create index if not exists idx_shift_change_audit_logs_store_created
  on public.shift_change_audit_logs (store_id, created_at desc);
