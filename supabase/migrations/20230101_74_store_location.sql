-- 74_store_location.sql
--
-- Adds latitude/longitude columns to the stores table and seeds coordinates
-- for the two existing stores (LV1, LV2).
--
-- PURPOSE:
--   Enables server-side weather API calls at clock-in/out. The backend reads
--   these coordinates and passes them to OpenWeatherMap to fetch current
--   conditions for the shift's store location.
--
-- MANAGEMENT:
--   Coordinates can also be updated through the admin Settings page via the
--   PATCH /api/admin/stores/[storeId]/location route — no migration needed
--   when adding future stores or correcting coordinates.
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS is a no-op if columns already exist.
--   UPDATE ... WHERE latitude IS NULL prevents overwriting any manually
--   entered values if the migration is re-run.

-- Step 1: add columns (no-op if they already exist)
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9,6) NULL,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6) NULL;

-- Step 2: add check constraints idempotently
ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS chk_stores_latitude_range;
ALTER TABLE public.stores
  ADD CONSTRAINT chk_stores_latitude_range CHECK (latitude BETWEEN -90 AND 90);

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS chk_stores_longitude_range;
ALTER TABLE public.stores
  ADD CONSTRAINT chk_stores_longitude_range CHECK (longitude BETWEEN -180 AND 180);

-- Step 3: seed known store coordinates
--   WHERE latitude IS NULL → idempotent; never overwrites a manually-set value.
UPDATE public.stores
  SET latitude = 32.529184, longitude = -94.787952
  WHERE name = 'LV1' AND latitude IS NULL;

UPDATE public.stores
  SET latitude = 32.535875, longitude = -94.766957
  WHERE name = 'LV2' AND latitude IS NULL;

-- Step 4: column comments
COMMENT ON COLUMN public.stores.latitude IS
  'Store latitude (WGS-84). Used for OpenWeatherMap weather lookups at clock-in/out. Editable via admin Settings → Store Locations.';

COMMENT ON COLUMN public.stores.longitude IS
  'Store longitude (WGS-84). Used for OpenWeatherMap weather lookups at clock-in/out. Editable via admin Settings → Store Locations.';
