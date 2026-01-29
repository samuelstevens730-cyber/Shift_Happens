create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text not null,
  role text not null default 'manager' check (role in ('manager')),
  created_at timestamptz not null default now()
);

alter table public.app_users enable row level security;

-- Only the logged in user can read their own app_user row
create policy "app_users_read_own"
on public.app_users
for select
using (auth.uid() = id);

-- Only the logged in user can update their own display name (optional)
create policy "app_users_update_own"
on public.app_users
for update
using (auth.uid() = id)
with check (auth.uid() = id);
