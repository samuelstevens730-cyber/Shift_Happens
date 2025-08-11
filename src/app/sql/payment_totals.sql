create table public.payment_totals (
  day_close_id uuid not null,
  cash_sales numeric(10, 2) null default 0,
  card_sales numeric(10, 2) null default 0,
  refunds numeric(10, 2) null default 0,
  constraint payment_totals_pkey primary key (day_close_id),
  constraint payment_totals_day_close_id_fkey foreign KEY (day_close_id) references day_closes (id) on delete CASCADE
) TABLESPACE pg_default;