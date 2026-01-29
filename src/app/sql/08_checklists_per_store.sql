-- Add per-store checklist templates and backfill from legacy templates.
-- Safe to run once when migrating from the old schema.

alter table public.checklist_templates
  add column if not exists store_id uuid null references public.stores(id) on delete cascade;

alter table public.checklist_templates
  drop constraint if exists checklist_templates_name_shift_type_key;

create unique index if not exists checklist_templates_store_name_shift_type_key
  on public.checklist_templates (store_id, name, shift_type);

-- Create per-store templates from legacy templates (store_id is null)
insert into public.checklist_templates (store_id, name, shift_type)
select s.id, t.name, t.shift_type
from public.stores s
cross join (
  select distinct name, shift_type
  from public.checklist_templates
  where store_id is null
) t
where not exists (
  select 1
  from public.checklist_templates ct
  where ct.store_id = s.id
    and ct.name = t.name
    and ct.shift_type = t.shift_type
);

-- Copy items from legacy templates into the new per-store templates
insert into public.checklist_items (template_id, label, sort_order, required)
select ct_new.id, ci.label, ci.sort_order, ci.required
from public.checklist_templates ct_old
join public.checklist_items ci on ci.template_id = ct_old.id
join public.checklist_templates ct_new
  on ct_new.store_id is not null
  and ct_new.name = ct_old.name
  and ct_new.shift_type = ct_old.shift_type
where ct_old.store_id is null
  and not exists (
    select 1
    from public.checklist_items ci2
    where ci2.template_id = ct_new.id
      and ci2.label = ci.label
      and ci2.sort_order = ci.sort_order
  );
