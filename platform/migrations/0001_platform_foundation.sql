CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'editor', 'approver', 'viewer');
CREATE TYPE run_status AS ENUM ('pending', 'queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled', 'timed_out', 'dead_lettered');
CREATE TYPE step_status AS ENUM ('pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting_approval', 'cancelled');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'expired');
CREATE TYPE job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'dead_lettered');

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_membership (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role workspace_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE brand_profile (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  tone text NOT NULL DEFAULT 'clear, helpful',
  language text NOT NULL DEFAULT 'en',
  forbidden_words jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy jsonb NOT NULL DEFAULT '{"approvalPolicy":"required","allowedModelClasses":["standard"]}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE secret (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  UNIQUE (workspace_id, purpose)
);

CREATE TABLE connected_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_account_id text NOT NULL,
  display_name text NOT NULL,
  secret_id uuid REFERENCES secret(id) ON DELETE SET NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'expired', 'disconnected', 'syncing')),
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, external_account_id)
);

CREATE TABLE workflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  current_version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_version (
  workflow_id uuid NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, version)
);

CREATE TABLE workflow_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflow(id),
  workflow_version integer NOT NULL,
  status run_status NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  input jsonb NOT NULL,
  context_snapshot jsonb NOT NULL,
  requested_by uuid NOT NULL REFERENCES app_user(id),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_version(workflow_id, version)
);

CREATE TABLE step_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status step_status NOT NULL DEFAULT 'pending',
  input jsonb,
  output jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (run_id, step_key, attempt)
);

CREATE TABLE approval_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  step_run_id uuid REFERENCES step_run(id) ON DELETE CASCADE,
  status approval_status NOT NULL DEFAULT 'pending',
  requested_action jsonb NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES app_user(id),
  decided_at timestamptz,
  decision_reason text
);

CREATE TABLE run_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, event_key)
);

CREATE TABLE task_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES workflow_run(id) ON DELETE CASCADE,
  step_run_id uuid REFERENCES step_run(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  billable_units numeric(12, 3) NOT NULL CHECK (billable_units >= 0),
  status text NOT NULL CHECK (status IN ('succeeded', 'reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_run_id, action_type, attempt)
);

CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  run_id uuid REFERENCES workflow_run(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  run_id uuid REFERENCES workflow_run(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_run_workspace_created_idx ON workflow_run (workspace_id, created_at DESC);
CREATE INDEX step_run_run_idx ON step_run (run_id, status);
CREATE INDEX approval_request_pending_idx ON approval_request (workspace_id, requested_at) WHERE status = 'pending';
CREATE INDEX run_event_timeline_idx ON run_event (run_id, created_at);
CREATE INDEX outbox_unpublished_idx ON outbox_event (available_at) WHERE published_at IS NULL;
CREATE INDEX job_ready_idx ON job (available_at) WHERE status = 'queued';

-- Tenant isolation is enforced in addition to the repository's transaction helper.
ALTER TABLE brand_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE job ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation ON brand_profile USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON secret USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON connected_account USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON workflow USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON workflow_version USING (workflow_id IN (SELECT id FROM workflow));
CREATE POLICY workspace_isolation ON workflow_run USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON step_run USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON approval_request USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON run_event USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON task_event USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON audit_event USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON outbox_event USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON job USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
