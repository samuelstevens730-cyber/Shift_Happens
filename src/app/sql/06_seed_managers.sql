-- Seed initial manager account + store assignments
-- Update or extend when additional managers are added.

insert into public.app_users (id, email, display_name, role)
values ('a4864e33-10ab-4730-8e73-edc2b52d3393', 'samuelstevens730@gmail.com', 'Sam Stevens', 'manager')
on conflict (id) do nothing;

insert into public.store_managers (store_id, user_id)
values
  ('98ab1644-5c82-4432-a661-f018bd9d4dc8', 'a4864e33-10ab-4730-8e73-edc2b52d3393'),
  ('ad4b6add-9c56-4708-99d2-6c78134f07fd', 'a4864e33-10ab-4730-8e73-edc2b52d3393')
on conflict do nothing;
