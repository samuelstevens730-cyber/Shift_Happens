-- Shift rules: single open shift per profile + long-shift override support

alter table public.profiles
  add column if not exists auth_user_id uuid null references auth.users(id) on delete set null;

create unique index if not exists profiles_auth_user_id_key
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

alter table public.shifts
  add column if not exists requires_override boolean not null default false,
  add column if not exists override_at timestamptz null,
  add column if not exists override_by uuid null,
  add column if not exists override_note text null;

create unique index if not exists shifts_one_open_per_profile_idx
  on public.shifts (profile_id)
  where ended_at is null;

create index if not exists shifts_requires_override_idx
  on public.shifts (requires_override, override_at)
  where requires_override = true and override_at is null;
