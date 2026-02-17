-- Add profile avatar columns for DiceBear-backed character creator.

alter table public.profiles
  add column if not exists avatar_style text not null default 'avataaars',
  add column if not exists avatar_seed text,
  add column if not exists avatar_options jsonb not null default '{}'::jsonb;

update public.profiles
set avatar_seed = id::text
where avatar_seed is null;
