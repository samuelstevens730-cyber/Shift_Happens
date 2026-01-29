alter table public.shift_drawer_counts
  add column if not exists count_missing boolean not null default false;

create index if not exists idx_shift_drawer_counts_missing
  on public.shift_drawer_counts (count_missing)
  where count_missing = true;
