create table public.cash_count (
  day_close_id uuid not null,
  till_start numeric(10, 2) null default 0,
  till_end_target numeric(10, 2) null default 200,
  counted_till_end numeric(10, 2) null default 0,
  change_drawer_target numeric(10, 2) null default 200,
  deposit_actual numeric(10, 2) null default 0,
  constraint cash_count_pkey primary key (day_close_id),
  constraint cash_count_day_close_id_fkey foreign KEY (day_close_id) references day_closes (id) on delete CASCADE
) TABLESPACE pg_default;