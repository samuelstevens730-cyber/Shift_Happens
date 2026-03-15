create table if not exists public.store_managers (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

alter table public.store_managers enable row level security;

-- Only managers assigned to a store can see their assignments
create policy "store_managers_read_own"
on public.store_managers
for select
using (auth.uid() = user_id);
