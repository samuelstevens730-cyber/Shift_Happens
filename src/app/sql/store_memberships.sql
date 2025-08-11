create table public.store_memberships (
  user_id uuid not null,
  store_id text not null,
  role text not null,
  constraint store_memberships_pkey primary key (user_id, store_id),
  constraint store_memberships_store_id_fkey foreign KEY (store_id) references stores (id) on delete CASCADE,
  constraint store_memberships_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint store_memberships_role_check check (
    (
      role = any (
        array['owner'::text, 'manager'::text, 'clerk'::text]
      )
    )
  )
) TABLESPACE pg_default;