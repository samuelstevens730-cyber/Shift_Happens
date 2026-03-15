-- Store-level toggle for rollover flow.
-- Allows management to enable/disable rollover behavior per store
-- without changing day-of-week config rows.

alter table if exists public.store_settings
  add column if not exists sales_rollover_enabled boolean not null default true;

