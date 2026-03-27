-- Soft-delete profile-targeted message rows that were migrated to the
-- notifications table in 20260326_notifications.sql.
--
-- Store-targeted messages retain their lazy-delivery semantics and must stay in
-- shift_assignments for clock-in delivery.
UPDATE public.shift_assignments
SET deleted_at = now()
WHERE type = 'message'
  AND target_profile_id IS NOT NULL
  AND deleted_at IS NULL;
