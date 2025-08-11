create table public.checklist_item_checks (
  id uuid not null default gen_random_uuid (),
  run_id uuid not null,
  item_id uuid not null,
  checked_by uuid not null,
  checked_at timestamp with time zone not null default now(),
  note text null,
  constraint checklist_item_checks_pkey primary key (id),
  constraint checklist_item_checks_checked_by_fkey foreign KEY (checked_by) references auth.users (id) on delete RESTRICT,
  constraint checklist_item_checks_item_id_fkey foreign KEY (item_id) references checklist_items (id) on delete CASCADE,
  constraint checklist_item_checks_run_id_fkey foreign KEY (run_id) references checklist_runs (id) on delete CASCADE
) TABLESPACE pg_default;