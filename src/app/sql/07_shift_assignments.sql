do $$ begin
  create type public.assignment_type as enum ('task','message');
exception when duplicate_object then null;
end $$;

create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  type public.assignment_type not null,
  message text not null,

  -- assignment target (exactly one should be set)
  target_profile_id uuid references public.profiles(id) on delete cascade,
  target_store_id uuid references public.stores(id) on delete cascade,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,

  -- delivery to a specific shift (next shift semantics)
  delivered_at timestamptz,
  delivered_shift_id uuid references public.shifts(id) on delete set null,
  delivered_profile_id uuid references public.profiles(id) on delete set null,
  delivered_store_id uuid references public.stores(id) on delete set null,

  -- message ack / task completion
  acknowledged_at timestamptz,
  acknowledged_shift_id uuid references public.shifts(id) on delete set null,
  completed_at timestamptz,
  completed_shift_id uuid references public.shifts(id) on delete set null,

  -- admin audit note
  audit_note text,
  audit_note_updated_at timestamptz,
  audit_note_by uuid references auth.users(id) on delete set null,

  -- soft delete
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

alter table public.shift_assignments
  drop constraint if exists shift_assignments_target_check;
alter table public.shift_assignments
  add constraint shift_assignments_target_check
  check (
    (target_profile_id is not null and target_store_id is null)
    or
    (target_profile_id is null and target_store_id is not null)
  );

create index if not exists idx_shift_assignments_target_profile
  on public.shift_assignments (target_profile_id)
  where target_profile_id is not null;

create index if not exists idx_shift_assignments_target_store
  on public.shift_assignments (target_store_id)
  where target_store_id is not null;

create index if not exists idx_shift_assignments_pending
  on public.shift_assignments (delivered_at)
  where delivered_at is null;

create index if not exists idx_shift_assignments_delivered_shift
  on public.shift_assignments (delivered_shift_id);

create index if not exists idx_shift_assignments_deleted
  on public.shift_assignments (deleted_at)
  where deleted_at is not null;
