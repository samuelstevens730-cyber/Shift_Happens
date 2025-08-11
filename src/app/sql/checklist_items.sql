create table public.checklist_items (
  id uuid not null default gen_random_uuid (),
  checklist_id uuid not null,
  order_num integer not null,
  text text not null,
  required boolean not null default true,
  manager_only boolean not null default false,
  required_for text not null default 'clock_out'::text,
  constraint checklist_items_pkey primary key (id),
  constraint checklist_items_checklist_id_fkey foreign KEY (checklist_id) references checklists (id) on delete CASCADE,
  constraint checklist_items_required_for_check check (
    (
      required_for = any (
        array['clock_in'::text, 'clock_out'::text, 'none'::text]
      )
    )
  )
) TABLESPACE pg_default;