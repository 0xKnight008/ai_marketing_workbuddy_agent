-- Workspace-shared review state on the existing RLS-protected report.
ALTER TABLE insight_report ADD COLUMN IF NOT EXISTS review_selection jsonb;
