do $$ begin
  alter type public.audit_action add value if not exists 'offer_denied';
exception when duplicate_object then null;
end $$;
