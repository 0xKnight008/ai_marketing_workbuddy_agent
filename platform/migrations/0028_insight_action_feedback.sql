-- Manual execution feedback, not supplier execution or publication approval.
-- Existing report RLS and tenant ownership continue to apply.
ALTER TABLE insight_report ADD COLUMN action_feedback jsonb NOT NULL DEFAULT '{}'::jsonb;
