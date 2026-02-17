-- Track owner/manager safe pickups (full-safe clear events).
-- This allows reconciliation to subtract pickup removals from expected/actual safe totals.

create table if not exists public.safe_pickups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  pickup_date date not null default current_date,
  pickup_at timestamptz not null default now(),
  amount_cents integer not null check (amount_cents >= 0),
  note text,
  recorded_by uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_safe_pickups_store_date
  on public.safe_pickups (store_id, pickup_date desc);

create index if not exists idx_safe_pickups_pickup_at
  on public.safe_pickups (pickup_at desc);
