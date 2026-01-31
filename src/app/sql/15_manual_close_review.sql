-- Track employee manual shift closures + manager review status
alter table public.shifts
  add column if not exists manual_closed boolean not null default false,
  add column if not exists manual_closed_at timestamptz,
  add column if not exists manual_closed_by_profile uuid references public.profiles(id) on delete set null,
  add column if not exists manual_closed_review_status text check (manual_closed_review_status in ('approved','edited','removed')),
  add column if not exists manual_closed_reviewed_at timestamptz,
  add column if not exists manual_closed_reviewed_by uuid references auth.users(id) on delete set null;

create index if not exists idx_shifts_manual_closed
  on public.shifts (manual_closed, manual_closed_reviewed_at);
x