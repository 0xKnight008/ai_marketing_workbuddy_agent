-- Module 3 (历史周复盘): immutable weekly execution snapshots.
-- The live weekly review is a current-state view (feedback edits rewrite it).
-- A snapshot freezes one ISO week's execution-time statistics the moment it
-- is sealed: later feedback changes never alter sealed history, which is what
-- makes cross-week comparison meaningful.

CREATE TABLE weekly_review_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- ISO week boundaries in UTC: week_start is a Monday 00:00, week_end is
  -- exclusive (always week_start + 7 days). Enforced by CHECK.
  week_start date NOT NULL,
  week_end date NOT NULL,
  -- Frozen computation: per-template execution counts, effect denominators,
  -- totals, and the completed-action list (including actions from older
  -- reports completed inside this window). Basis: feedback updatedAt.
  payload jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, week_start),
  CHECK (week_end = week_start + 7)
);

CREATE INDEX weekly_review_snapshot_workspace_idx ON weekly_review_snapshot (workspace_id, week_start DESC);

ALTER TABLE weekly_review_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_review_snapshot FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation ON weekly_review_snapshot USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
