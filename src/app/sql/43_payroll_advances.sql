-- Payroll advances (hours-first payroll reconciliation)
-- Stores advances separately so payroll can calculate:
-- worked + projected - verified advances = submitted hours

create table if not exists public.payroll_advances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  advance_date timestamptz not null default now(),
  advance_hours numeric(8,2) not null check (advance_hours > 0),
  cash_amount_cents integer check (cash_amount_cents is null or cash_amount_cents >= 0),
  note text,
  status text not null default 'pending_verification'
    check (status in ('pending_verification','verified','voided')),
  entered_by_profile_id uuid references public.profiles(id) on delete set null,
  verified_by_auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payroll_advances_profile_date
  on public.payroll_advances(profile_id, advance_date desc);

create index if not exists idx_payroll_advances_status_date
  on public.payroll_advances(status, advance_date desc);

create index if not exists idx_payroll_advances_store_date
  on public.payroll_advances(store_id, advance_date desc);
