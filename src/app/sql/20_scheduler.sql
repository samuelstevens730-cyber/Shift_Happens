-- Scheduler constraints, template seeds, and uniqueness rules
-- Run after 18_v2_workforce_migration.sql

-- Allow "other" mode to use open/close slots while still enforcing that shift_type "other"
-- implies shift_mode "other".
alter table public.schedule_shifts
  drop constraint if exists chk_other_mode_matches_type;

alter table public.schedule_shifts
  drop constraint if exists chk_other_type_matches_mode;

alter table public.schedule_shifts
  add constraint chk_other_type_matches_mode
  check (
    (shift_type != 'other') or (shift_mode = 'other')
  );

-- Enforce one assignment per store/date/slot.
create unique index if not exists idx_schedule_shifts_slot_unique
  on public.schedule_shifts (schedule_id, store_id, shift_date, shift_type);

-- Enforce one schedule per store per pay period.
create unique index if not exists idx_schedules_store_period_unique
  on public.schedules (store_id, period_start, period_end);

-- Seed weekly templates (LV1/LV2).
-- Day of week: 0=Sun ... 6=Sat
insert into public.shift_templates (store_id, day_of_week, shift_type, start_time, end_time, is_overnight)
select s.id, v.dow, v.shift_type, v.start_time, v.end_time, v.is_overnight
from public.stores s
join (
  values
    -- Mon-Wed
    (1, 'open',  '09:00', '15:00', false),
    (1, 'close', '15:00', '21:00', false),
    (2, 'open',  '09:00', '15:00', false),
    (2, 'close', '15:00', '21:00', false),
    (3, 'open',  '09:00', '15:00', false),
    (3, 'close', '15:00', '21:00', false),
    -- Thu
    (4, 'open',  '09:00', '15:30', false),
    (4, 'close', '15:30', '22:00', false),
    -- Fri-Sat
    (5, 'open',  '09:00', '17:00', false),
    (5, 'close', '17:00', '00:00', true),
    (6, 'open',  '09:00', '17:00', false),
    (6, 'close', '17:00', '00:00', true),
    -- Sun
    (0, 'open',  '12:00', '16:00', false),
    (0, 'close', '16:00', '21:00', false)
) as v(dow, shift_type, start_time, end_time, is_overnight)
  on true
where s.name in ('LV1', 'LV2')
on conflict do nothing;
