-- Prevent duplicate active shifts per employee
CREATE UNIQUE INDEX IF NOT EXISTS one_active_shift_per_employee 
ON shifts (profile_id) 
WHERE ended_at IS NULL;
