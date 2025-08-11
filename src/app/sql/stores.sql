create table public.stores (
  id text not null,
  name text not null,
  constraint stores_pkey primary key (id)
) TABLESPACE pg_default;