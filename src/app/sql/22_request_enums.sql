do $$ begin
  create type public.request_status as enum ('open','pending','approved','denied','cancelled','expired');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.swap_offer_type as enum ('cover','swap');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.audit_action as enum (
    'request_created',
    'offer_submitted',
    'offer_selected',
    'request_approved',
    'request_denied',
    'request_cancelled',
    'request_expired',
    'timesheet_corrected'
  );
exception when duplicate_object then null;
end $$;
