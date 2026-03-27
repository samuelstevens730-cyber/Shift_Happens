create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  source_store_id uuid references public.stores(id) on delete set null,

  notification_type text not null,
  priority text not null default 'normal' check (priority in ('high', 'normal')),
  title text not null,
  body text not null,

  entity_type text,
  entity_id uuid,

  read_at timestamptz,
  dismissed_at timestamptz,

  push_sent_at timestamptz,
  push_message_id text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,

  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_notifications_recipient_profile
  on public.notifications (recipient_profile_id, created_at desc)
  where deleted_at is null and dismissed_at is null;

alter table public.notifications enable row level security;

-- Notifications are served through service-role API routes, while employee auth
-- uses a custom PIN JWT. Route code enforces access control, so no auth.uid()-based
-- policies are added here.

insert into public.notifications (
  id,
  recipient_profile_id,
  source_store_id,
  notification_type,
  priority,
  title,
  body,
  read_at,
  dismissed_at,
  push_sent_at,
  push_message_id,
  created_at,
  created_by,
  deleted_at,
  deleted_by
)
select
  sa.id,
  sa.target_profile_id,
  null,
  'manager_message',
  'high',
  'Message from manager',
  sa.message,
  sa.acknowledged_at,
  sa.acknowledged_at,
  null,
  null,
  sa.created_at,
  sa.created_by,
  sa.deleted_at,
  sa.deleted_by
from public.shift_assignments sa
where sa.type = 'message'
  and sa.target_profile_id is not null
  -- Store-targeted legacy messages remain in shift_assignments because they use
  -- lazy-delivery semantics and cannot be safely attributed to one recipient.
on conflict (id) do nothing;
