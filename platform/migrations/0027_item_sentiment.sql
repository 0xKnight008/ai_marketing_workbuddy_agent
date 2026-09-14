-- Additive rollout: historical items remain NULL (unknown), not neutral.
-- Stored in the same tenant-protected row and classification transaction.
ALTER TABLE import_item ADD COLUMN sentiment jsonb;
