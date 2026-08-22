-- Zernio's multi-tenant contract is profile-per-customer. Keep the external
-- profile mapping tenant-scoped and retain the profile id on account rows so
-- webhook/account ownership can be checked without trusting provider input.
CREATE TABLE zernio_tenant (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  profile_id text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE connected_account ADD COLUMN zernio_profile_id text;
CREATE INDEX connected_account_zernio_profile_idx
  ON connected_account (zernio_profile_id, external_account_id)
  WHERE provider = 'zernio';

ALTER TABLE zernio_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE zernio_tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON zernio_tenant
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
