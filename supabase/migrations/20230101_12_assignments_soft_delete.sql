alter table public.shift_assignments
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null references auth.users(id) on delete set null;

create index if not exists idx_shift_assignments_deleted
  on public.shift_assignments (deleted_at)
  where deleted_at is not null;
