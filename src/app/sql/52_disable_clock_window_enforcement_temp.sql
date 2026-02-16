-- Temporary: disable DB clock-window enforcement for all shift inserts/updates.
-- This lets start/end-shift proceed while we redesign validation.

create or replace function public.enforce_clock_windows()
returns trigger
language plpgsql
as $$
begin
  return new;
end;
$$;
