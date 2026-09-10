CREATE TABLE platform_admin_link (
  token_hash text PRIMARY KEY, email text NOT NULL, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_admin_session (
  token_hash text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid(), email text NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_admin_login_limit (
  key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE platform_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, event_type text NOT NULL,
  workspace_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform_admin_link, platform_admin_session, platform_admin_login_limit, platform_admin_audit FROM PUBLIC;
CREATE INDEX platform_admin_link_expiry ON platform_admin_link(expires_at);
CREATE INDEX platform_admin_session_expiry ON platform_admin_session(expires_at);
CREATE INDEX platform_admin_limit_expiry ON platform_admin_login_limit(expires_at);
