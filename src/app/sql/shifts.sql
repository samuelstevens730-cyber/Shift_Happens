create table public.shifts (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  store_id text not null,
  start_at timestamp with time zone not null default now(),
  end_at timestamp with time zone null,
  status text not null default 'open'::text,
  changeover_confirmed boolean not null default false,
  changeover_at timestamp with time zone null,
  constraint shifts_pkey primary key (id),
  constraint shifts_store_id_fkey foreign KEY (store_id) references stores (id),
  constraint shifts_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete RESTRICT,
  constraint shifts_status_check check (
    (
      status = any (array['open'::text, 'closed'::text])
    )
  )
) TABLESPACE pg_default;