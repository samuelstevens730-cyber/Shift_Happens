-- Google Reviews Tracker table for monthly leaderboard submissions.
-- Adds screenshot-backed review entries with manager approval workflow.

create table if not exists public.google_reviews (
  id                      uuid primary key default gen_random_uuid(),
  store_id                uuid not null references public.stores(id) on delete cascade,
  profile_id              uuid not null references public.profiles(id) on delete cascade,
  submitted_by_type       text not null
                            check (submitted_by_type in ('employee', 'manager')),
  submitted_by_profile_id uuid references public.profiles(id) on delete set null,
  submitted_by_auth_id    text,
  review_date             date not null,
  screenshot_path         text not null,
  status                  text not null default 'draft'
                            check (status in ('draft', 'pending', 'approved', 'rejected')),
  reviewed_by             uuid references public.app_users(id) on delete set null,
  reviewed_at             timestamptz,
  rejection_reason        text,
  notes                   text,
  created_at              timestamptz not null default now()
);

create index if not exists google_reviews_store_status_date
  on public.google_reviews (store_id, status, review_date);

create index if not exists google_reviews_profile_status
  on public.google_reviews (profile_id, status);

create index if not exists google_reviews_status_created
  on public.google_reviews (status, created_at);

create index if not exists google_reviews_draft_cleanup
  on public.google_reviews (created_at)
  where status = 'draft';

alter table public.google_reviews enable row level security;

drop policy if exists "google_reviews_employee_select" on public.google_reviews;
drop policy if exists "google_reviews_employee_insert" on public.google_reviews;
drop policy if exists "google_reviews_manager_all" on public.google_reviews;

create policy "google_reviews_employee_select"
  on public.google_reviews
  for select
  to authenticated
  using (
    status = 'approved'
    or profile_id = (
      select id from public.profiles where auth_user_id = auth.uid() limit 1
    )
  );

create policy "google_reviews_employee_insert"
  on public.google_reviews
  for insert
  to authenticated
  with check (
    profile_id = (
      select id from public.profiles where auth_user_id = auth.uid() limit 1
    )
    and store_id = any (
      select store_id from public.store_memberships
      where profile_id = (
        select id from public.profiles where auth_user_id = auth.uid() limit 1
      )
    )
  );

create policy "google_reviews_manager_all"
  on public.google_reviews
  for all
  to authenticated
  using (
    store_id = any (
      select sm.store_id
      from public.store_managers sm
      where sm.user_id = auth.uid()
    )
  )
  with check (
    store_id = any (
      select sm.store_id
      from public.store_managers sm
      where sm.user_id = auth.uid()
    )
  );
