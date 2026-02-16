alter table if exists public.safe_closeouts
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users(id);

create index if not exists idx_safe_closeouts_edited_at
  on public.safe_closeouts(edited_at desc);
