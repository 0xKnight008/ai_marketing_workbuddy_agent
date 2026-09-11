-- Iteration 1 (P0 foundation): data import batches, raw items, and the shared
-- tag taxonomy with mandatory evidence citations. All tables are tenant-owned
-- and follow the same RLS posture as the rest of the platform.

CREATE TABLE import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  label text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('csv', 'paste', 'link', 'file')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'classifying', 'classified', 'failed')),
  model_band text NOT NULL DEFAULT 'eco' CHECK (model_band IN ('eco', 'standard', 'flagship')),
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  classified_at timestamptz
);

CREATE TABLE import_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'unknown',
  external_id text,
  author text,
  text text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 分类流水标记：无标签条目也要标记已处理，否则 worker 会重复消费。
  classified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The unified taxonomy (document: V1.0 Debug and Improvements §四.2 merged
-- with §2 内置分类标签). Tags are text + CHECK (not a PG enum) so the
-- taxonomy can evolve with a plain migration.
CREATE TABLE item_tag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES import_item(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (tag IN (
    'purchase_intent', 'product_demand', 'complaint', 'suggestion',
    'content_idea', 'urging_update', 'co_creation', 'koc_kol_lead',
    'meme_material', 'risk_event', 'needs_reply'
  )),
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  -- 证据引用：必须是原文逐字摘录，由平台侧校验后才落库。
  evidence text NOT NULL,
  model_band text NOT NULL DEFAULT 'eco' CHECK (model_band IN ('eco', 'standard', 'flagship')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, tag)
);

CREATE INDEX import_batch_workspace_idx ON import_batch (workspace_id, created_at DESC);
CREATE INDEX import_item_batch_idx ON import_item (batch_id, created_at);
CREATE INDEX item_tag_item_idx ON item_tag (item_id);
CREATE INDEX item_tag_workspace_tag_idx ON item_tag (workspace_id, tag);

ALTER TABLE import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batch FORCE ROW LEVEL SECURITY;
ALTER TABLE import_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_item FORCE ROW LEVEL SECURITY;
ALTER TABLE item_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_tag FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation ON import_batch USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON import_item USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON item_tag USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
