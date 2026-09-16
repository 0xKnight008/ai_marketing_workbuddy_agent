-- Module 4 (定时运营交付闭环): standing-delivery rules and the notification
-- event loop. A rule is the workspace's standing approval for one recurring
-- flow (morning push / evening recap / weekly report / urgent risk); every
-- concrete send is a notification_event with a dedup key, so retries and
-- schedule overlaps can never double-deliver. Weekly reports default to
-- 'approval' mode: the full digest waits as pending_approval until a human
-- clicks approve in the console. Suggested outbound actions inside reports
-- remain per-action approval-gated and are unaffected by these rules.

CREATE TABLE notification_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('morning_push', 'evening_recap', 'weekly_report', 'urgent_risk')),
  channel text NOT NULL CHECK (channel IN ('email', 'discord')),
  -- email channel: explicit recipient; NULL means workspace owner at send time.
  email text,
  -- discord channel: connected Zernio account (re-validated at send time).
  connected_account_id uuid REFERENCES connected_account(id) ON DELETE SET NULL,
  -- weekly_report only.
  weekly_template text CHECK (weekly_template IN ('content_recap', 'comment_insights', 'product_opportunities', 'review_attribution', 'community_digest')),
  weekly_delivery_mode text CHECK (weekly_delivery_mode IN ('approval', 'auto')),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind),
  CHECK (kind <> 'weekly_report' OR (weekly_template IS NOT NULL AND weekly_delivery_mode IS NOT NULL))
);

CREATE TABLE notification_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('morning_push', 'evening_recap', 'weekly_ready', 'weekly_report', 'urgent_risk')),
  -- pending_approval: content frozen, awaiting a human click (weekly approval
  -- delivery). queued: ready for the worker. sent/acknowledged/resolved form
  -- the urgent-risk loop. failed: terminal send error (see error column).
  status text NOT NULL CHECK (status IN ('pending_approval', 'queued', 'sent', 'failed', 'acknowledged', 'resolved')),
  dedup_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'discord')),
  target text NOT NULL,
  target_label text NOT NULL,
  subject text NOT NULL,
  content text NOT NULL,
  report_id uuid REFERENCES insight_report(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  acted_at timestamptz,
  acted_by uuid REFERENCES app_user(id),
  UNIQUE (workspace_id, dedup_key)
);

CREATE INDEX notification_event_workspace_idx ON notification_event (workspace_id, created_at DESC);
CREATE INDEX notification_event_alert_idx ON notification_event (workspace_id, kind, status);

ALTER TABLE notification_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_event FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation ON notification_rule USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON notification_event USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- Egg schedules run without a tenant context, so candidate selection (which
-- workspaces have a rule for a flow and an active subscription) lives in a
-- SECURITY DEFINER function, mirroring enqueue_daily_ops_reports(). All
-- per-workspace work afterwards runs through normal RLS-scoped transactions.
CREATE OR REPLACE FUNCTION scheduled_notification_workspaces(p_kind text)
RETURNS TABLE(workspace_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT r.workspace_id
      FROM notification_rule r
      JOIN workspace_billing wb ON wb.workspace_id = r.workspace_id
     WHERE r.kind = p_kind
       AND (wb.subscription_status IN ('active', 'trialing') OR wb.trial_ends_at > now())
     ORDER BY r.workspace_id
     LIMIT 200;
END;
$$;

REVOKE EXECUTE ON FUNCTION scheduled_notification_workspaces(text) FROM PUBLIC;
