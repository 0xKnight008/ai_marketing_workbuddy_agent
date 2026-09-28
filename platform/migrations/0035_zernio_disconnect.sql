-- Preserve explicit user disconnects across stale/eventually consistent syncs.
ALTER TABLE connected_account
  ADD COLUMN locally_disconnected boolean NOT NULL DEFAULT false;
