-- read your own shifts
create policy if not exists "select own shifts"
on public.shifts for select to authenticated
using (user_id = auth.uid());

-- update your own active shift
create policy if not exists "update own active shifts"
on public.shifts for update to authenticated
using (user_id = auth.uid() and end_at is null)
with check (user_id = auth.uid());
