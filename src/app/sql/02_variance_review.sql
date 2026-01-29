alter table public.shift_drawer_counts
add column if not exists reviewed_at timestamptz null,
add column if not exists reviewed_by uuid null;

create index if not exists idx_shift_drawer_counts_needs_review
on public.shift_drawer_counts (out_of_threshold, reviewed_at)
where out_of_threshold = true and reviewed_at is null;
