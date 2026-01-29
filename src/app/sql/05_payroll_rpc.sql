create or replace function public.payroll_shifts_range(
  p_from timestamptz,
  p_to   timestamptz,
  p_store_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  store_id uuid,
  start_at timestamptz,
  end_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Require auth
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    s.id,
    s.profile_id as user_id,
    s.store_id,
    s.started_at as start_at,
    s.ended_at   as end_at
  from public.shifts s
  where s.started_at >= p_from
    and s.started_at < p_to
    and s.ended_at is not null
    and exists (
      select 1
      from public.store_managers sm
      where sm.store_id = s.store_id
        and sm.user_id = auth.uid()
    )
    and (p_store_id is null or s.store_id = p_store_id)
  order by s.started_at asc;
end;
$$;

revoke all on function public.payroll_shifts_range(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.payroll_shifts_range(timestamptz, timestamptz, uuid) to authenticated;
