create table public.profiles (
  id uuid not null,
  full_name text null,
  global_role text not null default 'clerk'::text,
  default_store_id text null,
  pin_hash text null,
  pin_updated_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE,
  constraint profiles_global_role_check check (
    (
      global_role = any (
        array['owner'::text, 'manager'::text, 'clerk'::text]
      )
    )
  )
) TABLESPACE pg_default;