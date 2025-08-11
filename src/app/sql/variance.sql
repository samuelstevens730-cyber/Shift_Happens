create table public.variance (
  day_close_id uuid not null,
  expected_deposit numeric(10, 2) not null,
  over_short_amount numeric(10, 2) not null,
  status text not null,
  constraint variance_pkey primary key (day_close_id),
  constraint variance_day_close_id_fkey foreign KEY (day_close_id) references day_closes (id) on delete CASCADE,
  constraint variance_status_check check (
    (
      status = any (array['ok'::text, 'investigate'::text])
    )
  )
) TABLESPACE pg_default;