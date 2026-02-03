-- PIN auth columns + uniqueness guard for employee profiles
-- NOTE: pin_hash is bcrypt; uniqueness is enforced via pin_fingerprint (deterministic HMAC stored by app).

alter table public.profiles
  add column if not exists pin_hash text,
  add column if not exists pin_fingerprint text,
  add column if not exists pin_locked_until timestamptz,
  add column if not exists pin_failed_attempts int default 0;

-- Only allow unique active PINs (via deterministic fingerprint, not bcrypt hash).
create unique index if not exists idx_profiles_pin_unique_active
  on public.profiles (pin_fingerprint)
  where pin_fingerprint is not null and active = true;

-- Optional lookup index for auth checks
create index if not exists idx_profiles_pin_active
  on public.profiles(pin_fingerprint)
  where pin_fingerprint is not null and active = true;
