-- Google Sheets import: one OAuth connection per workspace (refresh token
-- encrypted at rest with SECRET_ENCRYPTION_KEY_BASE64) plus the new source
-- type and a dedup index for imported rows. Same RLS posture as 0021.

ALTER TABLE import_batch DROP CONSTRAINT import_batch_source_type_check;
ALTER TABLE import_batch ADD CONSTRAINT import_batch_source_type_check
  CHECK (source_type IN ('csv', 'paste', 'link', 'file', 'discord', 'google_sheets'));

CREATE TABLE google_sheets_connection (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  google_email text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  refresh_token_iv text NOT NULL,
  refresh_token_auth_tag text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  connected_by uuid NOT NULL REFERENCES app_user(id),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE google_sheets_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_sheets_connection FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON google_sheets_connection
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- external_id values from Google Sheets rows are namespaced 'gsheets:' so this
-- partial index covers re-import dedup regardless of the item platform column.
CREATE INDEX import_item_google_sheets_external_idx ON import_item (workspace_id, external_id)
  WHERE external_id LIKE 'gsheets:%';
