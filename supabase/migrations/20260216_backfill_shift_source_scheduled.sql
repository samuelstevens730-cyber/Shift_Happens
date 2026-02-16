update public.shifts
set
  shift_source = 'scheduled'
where schedule_shift_id is not null
  and coalesce(shift_source, 'manual') <> 'scheduled';
