alter table if exists public.safe_closeouts
  add column if not exists is_historical_backfill boolean not null default false;

create index if not exists idx_safe_closeouts_historical_backfill
  on public.safe_closeouts(is_historical_backfill, business_date desc);
