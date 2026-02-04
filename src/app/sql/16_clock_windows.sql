-- Clock window config + enforcement trigger (America/Chicago)
-- NOTE: Triggers must be created in Supabase SQL editor.

create table if not exists public.clock_windows (
  id uuid primary key default gen_random_uuid(),
  store_key text not null check (store_key in ('LV1','LV2')),
  shift_type text not null check (shift_type in ('open','close')),
  dow smallint not null check (dow between 0 and 6),
  start_min smallint not null check (start_min between 0 and 1439),
  end_min smallint not null check (end_min between 0 and 1439),
  crosses_midnight boolean not null default false,
  label text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_clock_windows_lookup
  on public.clock_windows (store_key, shift_type, dow);

-- Seed windows (safe to re-run)
insert into public.clock_windows (store_key, shift_type, dow, start_min, end_min, crosses_midnight, label)
values
  -- OPEN (9 AM) Mon-Sat
  ('LV1','open',1,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',2,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',3,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',4,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',5,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV1','open',6,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',1,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',2,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',3,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',4,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',5,535,545,false,'Open window 8:55-9:05 AM CST'),
  ('LV2','open',6,535,545,false,'Open window 8:55-9:05 AM CST'),
  -- OPEN Sunday (12 PM)
  ('LV1','open',0,715,725,false,'Open window 11:55-12:05 PM CST'),
  ('LV2','open',0,715,725,false,'Open window 11:55-12:05 PM CST'),

  -- CLOSE LV1
  ('LV1','close',1,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV1','close',2,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV1','close',3,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV1','close',4,1310,1335,false,'Close window 9:50-10:15 PM CST'),
  ('LV1','close',5,1310,1335,false,'Close window 9:50-10:15 PM CST'),
  ('LV1','close',6,1310,1335,false,'Close window 9:50-10:15 PM CST'),
  ('LV1','close',0,1250,1275,false,'Close window 8:50-9:15 PM CST'),

  -- CLOSE LV2
  ('LV2','close',1,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV2','close',2,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV2','close',3,1250,1275,false,'Close window 8:50-9:15 PM CST'),
  ('LV2','close',4,1310,1335,false,'Close window 9:50-10:15 PM CST'),
  ('LV2','close',5,1430,15,true,'Close window 11:50 PM-12:15 AM CST'),
  ('LV2','close',6,1430,15,true,'Close window 11:50 PM-12:15 AM CST'),
  ('LV2','close',0,1250,1275,false,'Close window 8:50-9:15 PM CST')
on conflict do nothing;

-- Helper to get store_key (LV1/LV2) from stores.name
create or replace function public.store_key_for_id(p_store_id uuid)
returns text
language sql
stable
as $$
  select case
    when s.name ilike 'LV1' then 'LV1'
    when s.name ilike 'LV2' then 'LV2'
    else null
  end
  from public.stores s
  where s.id = p_store_id
$$;

-- Validate a timestamp against window rules
create or replace function public.clock_window_check(
  p_store_id uuid,
  p_shift_type public.shift_type,
  p_time timestamptz
)
returns void
language plpgsql
security definer
as $$
declare
  store_key text;
  local_ts timestamp;
  local_dow int;
  local_min int;
  ok boolean := false;
  lbl text := null;
begin
  store_key := public.store_key_for_id(p_store_id);
  if store_key is null then
    raise exception 'CLOCK_WINDOW_VIOLATION: unknown store' using errcode = 'P0001';
  end if;

  -- derive local time in America/Chicago
  local_ts := p_time at time zone 'America/Chicago';
  local_dow := extract(dow from local_ts);
  local_min := extract(hour from local_ts) * 60 + extract(minute from local_ts);

  -- try exact day window
  select cw.label,
         (
           (not cw.crosses_midnight and local_min between cw.start_min and cw.end_min and cw.dow = local_dow)
           or
           (cw.crosses_midnight and cw.dow = local_dow and (local_min >= cw.start_min or local_min <= cw.end_min))
           or
           (cw.crosses_midnight and ((cw.dow + 1) % 7) = local_dow and local_min <= cw.end_min)
         )
  into lbl, ok
  from public.clock_windows cw
  where cw.store_key = store_key
    and cw.shift_type = p_shift_type::text
    and (
      cw.dow = local_dow
      or (cw.crosses_midnight and ((cw.dow + 1) % 7) = local_dow)
    )
  limit 1;

  if not ok then
    raise exception 'CLOCK_WINDOW_VIOLATION: %', coalesce(lbl, 'Outside allowed clock window')
      using errcode = 'P0001';
  end if;
end;
$$;

-- Trigger to enforce clock windows on shifts
create or replace function public.enforce_clock_windows()
returns trigger
language plpgsql
as $$
begin
  -- Clock-in: validate planned_start_at for open only
  if TG_OP = 'INSERT' then
    if new.shift_type in ('open') then
      perform public.clock_window_check(new.store_id, new.shift_type, new.planned_start_at);
    end if;
    return new;
  end if;

  -- Clock-out: validate ended_at for close shifts only
  if TG_OP = 'UPDATE' and new.ended_at is distinct from old.ended_at and new.ended_at is not null then
    if new.shift_type = 'close' then
      perform public.clock_window_check(new.store_id, 'close', new.ended_at);
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_clock_windows on public.shifts;
create trigger trg_enforce_clock_windows
before insert or update of ended_at on public.shifts
for each row
execute function public.enforce_clock_windows();
