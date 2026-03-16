-- Add a per-store sales sanity ceiling to catch obviously wrong Z report / safe closeout entries.
-- Any submission above this amount requires the employee to explicitly confirm before it saves.
-- Default: 250000 cents ($2,500) — well above any expected daily sales for these stores.
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS sales_sanity_ceiling_cents INTEGER NOT NULL DEFAULT 250000;
