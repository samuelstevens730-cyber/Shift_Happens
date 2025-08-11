create table public.day_closes (
  id uuid not null default gen_random_uuid (),
  date date not null default ((now() AT TIME ZONE 'utc'::text))::date,
  store_id text not null,
  clerk_id uuid not null,
  manager_id uuid null,
  notes text null,
  constraint day_closes_pkey primary key (id),
  constraint day_closes_clerk_id_fkey foreign KEY (clerk_id) references auth.users (id) on delete RESTRICT,
  constraint day_closes_manager_id_fkey foreign KEY (manager_id) references auth.users (id) on delete RESTRICT,
  constraint day_closes_store_id_fkey foreign KEY (store_id) references stores (id)
) TABLESPACE pg_default;