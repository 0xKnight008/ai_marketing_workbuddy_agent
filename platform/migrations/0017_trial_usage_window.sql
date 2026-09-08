ALTER TABLE workspace_billing ADD COLUMN trial_started_at timestamptz;
-- Existing trials used the configured seven-day offer. Preserve a full trial
-- window across calendar-month boundaries instead of replenishing its credits.
UPDATE workspace_billing SET trial_started_at = trial_ends_at - interval '7 days'
WHERE trial_ends_at IS NOT NULL;
