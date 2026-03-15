alter table public.shifts
  add column if not exists last_action text not null default 'added'
    check (last_action in ('added','edited','removed')),
  add column if not exists last_action_by uuid null references auth.users(id) on delete set null;

create index if not exists idx_shifts_last_action
  on public.shifts (last_action);
