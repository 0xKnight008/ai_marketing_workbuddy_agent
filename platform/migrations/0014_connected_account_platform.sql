ALTER TABLE connected_account
  ADD COLUMN platform text NOT NULL DEFAULT 'unknown';

CREATE INDEX connected_account_platform_idx
  ON connected_account (workspace_id, platform, status);
