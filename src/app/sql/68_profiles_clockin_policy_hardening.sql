-- Tighten profiles exposure by removing broad clock-in policy.
-- Production-safe, forward-only hardening.
--
-- Approach:
-- - Remove the overly broad anon/authenticated policy that exposed all profile rows.
-- - Keep existing self/manager policies intact.
-- - Avoid global table grant changes in this migration.

alter table if exists public.profiles enable row level security;

drop policy if exists "profiles_select_clock_in" on public.profiles;
