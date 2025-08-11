create table public.checklists (
  id uuid not null default gen_random_uuid (),
  name text not null,
  applies_to_role text not null,
  kind text not null,
  store_id text not null,
  constraint checklists_pkey primary key (id),
  constraint checklists_store_id_fkey foreign KEY (store_id) references stores (id),
  constraint checklists_applies_to_role_check check (
    (
      applies_to_role = any (
        array['owner'::text, 'manager'::text, 'clerk'::text]
      )
    )
  ),
  constraint checklists_kind_check check (
    (
      kind = any (
        array['opening'::text, 'closing'::text, 'shift'::text]
      )
    )
  )
) TABLESPACE pg_default;