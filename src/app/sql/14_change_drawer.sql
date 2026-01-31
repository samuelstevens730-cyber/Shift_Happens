-- Add change drawer count to shift drawer counts
alter table public.shift_drawer_counts
  add column if not exists change_count integer;
