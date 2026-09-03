CREATE TABLE activation_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  stripe_event_id text UNIQUE NOT NULL,
  token_hash char(64) UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  email_sent_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activation_ticket_workspace_created_idx ON activation_ticket (workspace_id, created_at DESC);
CREATE INDEX activation_ticket_unconsumed_idx ON activation_ticket (expires_at) WHERE consumed_at IS NULL;

ALTER TABLE activation_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_ticket FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activation_ticket USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
