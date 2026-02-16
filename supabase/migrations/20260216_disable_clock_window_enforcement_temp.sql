create or replace function public.enforce_clock_windows()
returns trigger
language plpgsql
as $$
begin
  return new;
end;
$$;
