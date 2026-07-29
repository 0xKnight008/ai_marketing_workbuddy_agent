CREATE TABLE workspace_billing (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'creator' CHECK (plan IN ('creator', 'growth', 'agency')),
  period_start date NOT NULL DEFAULT date_trunc('month', now())::date,
  purchased_ai_credits numeric(12, 3) NOT NULL DEFAULT 0 CHECK (purchased_ai_credits >= 0),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  subscription_status text NOT NULL DEFAULT 'inactive',
  trial_ends_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX workspace_billing_stripe_subscription_idx ON workspace_billing (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE billing_webhook_event (
  provider text NOT NULL,
  external_event_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_event_id)
);

ALTER TABLE task_event ADD COLUMN ai_credits numeric(12, 3) NOT NULL DEFAULT 0 CHECK (ai_credits >= 0);
ALTER TABLE task_event ADD COLUMN supplier_cost_micros bigint NOT NULL DEFAULT 0 CHECK (supplier_cost_micros >= 0);
CREATE INDEX task_event_workspace_month_idx ON task_event (workspace_id, created_at DESC);

ALTER TABLE workspace_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_billing FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_billing USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
ALTER TABLE billing_webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_event FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON billing_webhook_event USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
