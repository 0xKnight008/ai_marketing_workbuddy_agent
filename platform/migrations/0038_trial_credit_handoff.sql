-- Separate free trial usage from paid monthly allowance; retain the unused trial
-- remainder when a paid subscription starts in the middle of a model step.
ALTER TABLE task_event ADD COLUMN trial_ai_credits numeric(12,3) NOT NULL DEFAULT 0
  CHECK (trial_ai_credits >= 0 AND trial_ai_credits <= ai_credits);
ALTER TABLE workspace_billing ADD COLUMN trial_credit_handoff_at timestamptz;
ALTER TABLE workspace_billing ADD COLUMN trial_credit_handoff_pending boolean NOT NULL DEFAULT false;
ALTER TABLE workspace_billing ADD COLUMN trial_credit_carryover numeric(12,3) NOT NULL DEFAULT 0
  CHECK (trial_credit_carryover >= 0 AND trial_credit_carryover <= 30);
UPDATE task_event e SET trial_ai_credits=e.ai_credits
FROM workspace_billing b WHERE b.workspace_id=e.workspace_id
  AND b.trial_started_at IS NOT NULL AND e.created_at >= b.trial_started_at
  AND e.created_at < COALESCE(b.trial_ends_at, b.trial_started_at + interval '7 days');
