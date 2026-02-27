-- 73_weather_on_shifts.sql
--
-- Adds start/end weather snapshot columns to the shifts table.
--
-- WHY NO DEFAULT:
--   Omitting DEFAULT means Postgres stores NULL for every existing row.
--   Historical shifts simply have no weather data — they do not participate
--   in weather-based analysis.
--
-- IDEMPOTENCY:
--   ADD COLUMN IF NOT EXISTS skips silently when the column already exists,
--   which also skips any inline CONSTRAINT clause. Separate ALTER TABLE
--   blocks below ensure constraints are always present.
--
-- DATA SOURCE:
--   Columns are written by the backend (start-shift and end-shift routes)
--   via a server-side OpenWeatherMap API call. Never written by the client.

-- Step 1: add columns (no-op if they already exist)
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS start_weather_condition TEXT    NULL,
  ADD COLUMN IF NOT EXISTS start_weather_desc      TEXT    NULL,
  ADD COLUMN IF NOT EXISTS start_temp_f             INTEGER NULL,
  ADD COLUMN IF NOT EXISTS end_weather_condition   TEXT    NULL,
  ADD COLUMN IF NOT EXISTS end_weather_desc        TEXT    NULL,
  ADD COLUMN IF NOT EXISTS end_temp_f               INTEGER NULL;

-- Step 2: add check constraints idempotently
--   Temperature range: -60°F to 140°F covers all realistic conditions.
--   PREFLIGHT (run before applying this migration if columns may already
--   exist with data — ADD CONSTRAINT fails if any rows violate it):
--
--     SELECT COUNT(*) FROM public.shifts WHERE start_temp_f NOT BETWEEN -60 AND 140;
--     SELECT COUNT(*) FROM public.shifts WHERE end_temp_f   NOT BETWEEN -60 AND 140;
--
--   Both queries must return 0 before proceeding.
ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS chk_start_temp_f_range;
ALTER TABLE public.shifts
  ADD CONSTRAINT chk_start_temp_f_range CHECK (start_temp_f BETWEEN -60 AND 140);

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS chk_end_temp_f_range;
ALTER TABLE public.shifts
  ADD CONSTRAINT chk_end_temp_f_range CHECK (end_temp_f BETWEEN -60 AND 140);

-- Step 3: column comments
COMMENT ON COLUMN public.shifts.start_weather_condition IS
  'Weather condition string at clock-in time (e.g. "Clear", "Rain"). NULL = not captured (API unavailable or historical shift).';

COMMENT ON COLUMN public.shifts.start_weather_desc IS
  'Detailed weather description at clock-in time (e.g. "clear sky", "heavy intensity rain"). Source: OWM weather[0].description. NULL = not captured.';

COMMENT ON COLUMN public.shifts.start_temp_f IS
  'Temperature in °F at clock-in time. NULL = not captured.';

COMMENT ON COLUMN public.shifts.end_weather_condition IS
  'Weather condition string at clock-out time. Falls back to start_weather_condition if API fails at clock-out. NULL = not captured.';

COMMENT ON COLUMN public.shifts.end_weather_desc IS
  'Detailed weather description at clock-out time (e.g. "overcast clouds"). Source: OWM weather[0].description. NULL = not captured.';

COMMENT ON COLUMN public.shifts.end_temp_f IS
  'Temperature in °F at clock-out time. Falls back to start_temp_f if API fails at clock-out. NULL = not captured.';
