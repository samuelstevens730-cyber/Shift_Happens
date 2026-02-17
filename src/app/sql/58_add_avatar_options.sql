-- Add avatar identity + option overrides for profile-level character customization.
-- Example payload:
-- {
--   "top": "longHair",
--   "accessories": "sunglasses",
--   "facialHair": "beardMajestic",
--   "skinColor": "ffdbb4"
-- }

alter table public.profiles
  add column if not exists avatar_style text not null default 'avataaars',
  add column if not exists avatar_seed text,
  add column if not exists avatar_options jsonb not null default '{}'::jsonb;

-- Backfill deterministic seed for existing users if null.
update public.profiles
set avatar_seed = id::text
where avatar_seed is null;
