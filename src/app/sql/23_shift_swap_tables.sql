create table if not exists public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  schedule_shift_id uuid not null references public.schedule_shifts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  requester_profile_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  status public.request_status not null default 'open',
  selected_offer_id uuid,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  denial_reason text,
  expires_at timestamptz not null,
  nudge_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_swap_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.shift_swap_requests(id) on delete cascade,
  offerer_profile_id uuid not null references public.profiles(id) on delete cascade,
  offer_type public.swap_offer_type not null,
  swap_schedule_shift_id uuid references public.schedule_shifts(id),
  is_selected boolean not null default false,
  is_withdrawn boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  constraint shift_swap_offers_request_offerer_unique unique (request_id, offerer_profile_id),
  constraint shift_swap_offers_swap_requires_shift
    check (offer_type != 'swap' or swap_schedule_shift_id is not null)
);

alter table public.shift_swap_requests
  drop constraint if exists shift_swap_requests_selected_offer_id_fkey;

alter table public.shift_swap_requests
  add constraint shift_swap_requests_selected_offer_id_fkey
  foreign key (selected_offer_id) references public.shift_swap_offers(id);

create index if not exists idx_swap_requests_schedule_shift
  on public.shift_swap_requests (schedule_shift_id);

create index if not exists idx_swap_requests_store_status
  on public.shift_swap_requests (store_id, status);

create index if not exists idx_swap_requests_expires
  on public.shift_swap_requests (expires_at)
  where status = 'open';

create index if not exists idx_swap_offers_request
  on public.shift_swap_offers (request_id);
