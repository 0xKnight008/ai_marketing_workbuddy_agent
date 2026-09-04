-- Email + password sign-in for the console. The password hash lives on the
-- intentionally global app_user table (no RLS, like the workspace directory);
-- it must only ever be written through the platform service role.
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_updated_at timestamptz;

-- Fast lookup for login; email is already UNIQUE via citext, so no extra index.
-- Guard against obviously malformed hashes entering the column.
ALTER TABLE app_user ADD CONSTRAINT app_user_password_hash_format
  CHECK (password_hash IS NULL OR password_hash LIKE 'scrypt:%');
