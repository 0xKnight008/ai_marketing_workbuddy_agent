ALTER TABLE task_event ADD COLUMN supplier text NOT NULL DEFAULT 'primary';
CREATE INDEX task_event_workspace_supplier_idx ON task_event (workspace_id, supplier, created_at DESC);
