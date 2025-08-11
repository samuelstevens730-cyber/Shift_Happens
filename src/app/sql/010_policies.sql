-- Enable RLS on each table that has policies
alter table public.checklist_item_checks enable row level security;
alter table public.checklist_runs        enable row level security;
alter table public.shifts                enable row level security;
alter table public.store_memberships     enable row level security;
alter table public.variance              enable row level security;

-- Policies (your exported definitions)

create policy "checks mapped"
on "public"."checklist_item_checks"
for all
to authenticated
using (
  exists (
    select 1 from checklist_runs r
    where r.id = checklist_item_checks.run_id
      and has_store_access(r.store_id)
  )
)
with check (
  exists (
    select 1 from checklist_runs r
    where r.id = checklist_item_checks.run_id
      and has_store_access(r.store_id)
  )
);

create policy "runs mapped"
on "public"."checklist_runs"
for all
to authenticated
using (has_store_access(store_id))
with check (has_store_access(store_id));

create policy "insert own shifts"
on "public"."shifts"
for insert
to authenticated
with check (user_id = auth.uid());

create policy "sm self read"
on "public"."store_memberships"
for select
to authenticated
using (user_id = auth.uid());

create policy "variance mapped"
on "public"."variance"
for all
to authenticated
using (
  exists (
    select 1 from day_closes d
    where d.id = variance.day_close_id
      and has_store_access(d.store_id)
  )
)
with check (
  exists (
    select 1 from day_closes d
    where d.id = variance.day_close_id
      and has_store_access(d.store_id)
  )
);
