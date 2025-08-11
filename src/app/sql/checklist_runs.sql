create table public.checklist_runs (
  id uuid not null default gen_random_uuid (),
  checklist_id uuid not null,
  shift_id uuid not null,
  store_id text not null,
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone null,
  status text not null default 'in_progress'::text,
  constraint checklist_runs_pkey primary key (id),
  constraint checklist_runs_checklist_id_fkey foreign KEY (checklist_id) references checklists (id) on delete CASCADE,
  constraint checklist_runs_shift_id_fkey foreign KEY (shift_id) references shifts (id) on delete CASCADE,
  constraint checklist_runs_store_id_fkey foreign KEY (store_id) references stores (id),
  constraint checklist_runs_status_check check (
    (
      status = any (array['in_progress'::text, 'done'::text])
    )
  )
) TABLESPACE pg_default;