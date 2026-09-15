ALTER TABLE import_batch DROP CONSTRAINT import_batch_source_type_check;
ALTER TABLE import_batch ADD CONSTRAINT import_batch_source_type_check
  CHECK (source_type IN ('csv', 'paste', 'link', 'file', 'discord'));
CREATE INDEX import_item_discord_external_idx ON import_item (workspace_id, external_id)
  WHERE platform = 'discord';
