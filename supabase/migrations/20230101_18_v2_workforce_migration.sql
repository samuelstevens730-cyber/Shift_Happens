-- V2 Workforce Management Schema Migration (cleaned)
-- Phase 1: Schedule & Shift Extensions
-- Run this after: stores, schedules tables exist

BEGIN;

-- ============================================
-- 1. PROFILES TABLE: PIN Auth Columns
-- ============================================

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS pin_hash TEXT,
ADD COLUMN IF NOT EXISTS pin_fingerprint TEXT,
ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS pin_failed_attempts INT DEFAULT 0;

-- Enforce unique PINs via deterministic fingerprint (HMAC of pin in app code)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_pin_unique_active
ON public.profiles(pin_fingerprint)
WHERE pin_fingerprint IS NOT NULL AND active = true;

-- Optional lookup index for auth checks
CREATE INDEX IF NOT EXISTS idx_profiles_pin_active 
ON public.profiles(pin_fingerprint) 
WHERE pin_fingerprint IS NOT NULL AND active = true;

-- ============================================
-- 2. STORE SETTINGS: Feature Flags
-- ============================================

CREATE TABLE IF NOT EXISTS public.store_settings (
  store_id UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  v2_pin_auth_enabled BOOLEAN DEFAULT false,
  v2_scheduling_enabled BOOLEAN DEFAULT false,
  v2_user_dashboard_enabled BOOLEAN DEFAULT false,
  pin_max_attempts INT DEFAULT 3,
  pin_lockout_minutes INT DEFAULT 30,
  schedule_publish_lead_hours INT DEFAULT 24,
  drawer_variance_soft_cents INT DEFAULT 500,
  drawer_variance_hard_cents INT DEFAULT 1500,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Initialize settings for existing stores
INSERT INTO public.store_settings (store_id) 
SELECT id FROM public.stores 
ON CONFLICT DO NOTHING;

-- ============================================
-- 3. SHIFT TEMPLATES: Weekly Patterns
-- ============================================

CREATE TABLE IF NOT EXISTS public.shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),
  shift_type public.shift_type NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_overnight BOOLEAN DEFAULT false,
  UNIQUE(store_id, day_of_week, shift_type)
);

-- ============================================
-- 4. SCHEDULES: Pay Period Instances
-- ============================================

CREATE TABLE IF NOT EXISTS public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_store_period 
ON public.schedules(store_id, period_start, period_end);

-- ============================================
-- 5. SCHEDULE_SHIFTS: Individual Assignments
-- ============================================

CREATE TABLE IF NOT EXISTS public.schedule_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id), -- backfilled in step 7
  profile_id UUID NOT NULL REFERENCES public.profiles(id),
  shift_date DATE NOT NULL,
  shift_type public.shift_type NOT NULL,
  shift_mode TEXT DEFAULT 'standard' CHECK (shift_mode IN ('standard', 'double', 'other')),
  scheduled_start TIME NOT NULL,
  scheduled_end TIME NOT NULL,
  template_id UUID REFERENCES public.shift_templates(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Constraints
ALTER TABLE public.schedule_shifts
ADD CONSTRAINT chk_other_mode_matches_type 
CHECK (
  (shift_mode != 'other') OR 
  (shift_mode = 'other' AND shift_type = 'other')
);

ALTER TABLE public.schedule_shifts
ADD CONSTRAINT chk_other_type_matches_mode
CHECK (
  (shift_type != 'other') OR (shift_mode = 'other')
);

-- Unique: one shift per person per day per type (exclude other)
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_shifts_unique 
ON public.schedule_shifts(schedule_id, profile_id, shift_date, shift_type)
WHERE shift_mode != 'other';

-- Index for double lookups
CREATE INDEX IF NOT EXISTS idx_schedule_shifts_double_mode 
ON public.schedule_shifts(schedule_id, shift_date, shift_mode) 
WHERE shift_mode = 'double';

-- ============================================
-- 6. SHIFTS TABLE: Extensions
-- ============================================

ALTER TABLE public.shifts 
ADD COLUMN IF NOT EXISTS schedule_shift_id UUID REFERENCES public.schedule_shifts(id),
ADD COLUMN IF NOT EXISTS shift_source TEXT DEFAULT 'scheduled'
  CHECK (shift_source IN ('scheduled', 'manual', 'coverage', 'emergency')),
ADD COLUMN IF NOT EXISTS shift_note TEXT,
ADD COLUMN IF NOT EXISTS coverage_for UUID REFERENCES public.profiles(id);

-- ============================================
-- 7. BACKFILL: schedule_shifts.store_id
-- ============================================

UPDATE public.schedule_shifts ss
SET store_id = s.store_id
FROM public.schedules s
WHERE ss.schedule_id = s.id AND ss.store_id IS NULL;

-- Verification query (run separately to confirm):
-- SELECT
--   COUNT(*) AS total_shifts,
--   COUNT(*) FILTER (WHERE store_id IS NOT NULL) AS with_store_id,
--   COUNT(*) FILTER (WHERE store_id IS NULL) AS missing_store_id
-- FROM public.schedule_shifts;

-- Only enable after verification shows 0 missing:
-- ALTER TABLE public.schedule_shifts ALTER COLUMN store_id SET NOT NULL;

-- ============================================
-- 8. INDEXES: Clock-in Lookup
-- ============================================

CREATE INDEX IF NOT EXISTS idx_schedule_shifts_clock_lookup
ON public.schedule_shifts(store_id, profile_id, shift_date, shift_type, shift_mode);

-- Employee schedule view index
CREATE INDEX IF NOT EXISTS idx_schedule_shifts_employee_date 
ON public.schedule_shifts(profile_id, shift_date);

-- ============================================
-- 9. V3 PREP TABLES (Optional, can skip)
-- ============================================

CREATE TABLE IF NOT EXISTS public.coverage_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_shift_id UUID NOT NULL REFERENCES public.schedule_shifts(id),
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'filled', 'approved', 'cancelled')),
  filled_by UUID REFERENCES public.profiles(id),
  manager_approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shift_edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES public.shifts(id),
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  field_name TEXT NOT NULL,
  current_value TEXT,
  requested_value TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMIT;
