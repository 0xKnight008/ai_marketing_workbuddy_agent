-- Module 2 (全量主题聚类与可信计数): concrete topic clustering over every
-- classified item, with platform-verified counts. Counts are never LLM
-- claims: they are row counts over item_topic, whose rows are only written
-- after verbatim-evidence validation (same posture as item_tag).

-- 一次全量聚类运行。同一工作区同一时间只允许一个非终态运行
-- （service 层在创建时检查并返回 409）。
CREATE TABLE topic_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'proposing', 'assigning', 'completed', 'failed')),
  model_band text NOT NULL DEFAULT 'eco' CHECK (model_band IN ('eco', 'standard', 'flagship')),
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  topic_count integer NOT NULL DEFAULT 0 CHECK (topic_count >= 0),
  error text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- 一个具体主题（如"希望支持 TikTok Shop 导入"）。topic_key 是该次运行
-- taxonomy 内的稳定标识，分块指派按 key 引用，避免多语言 label 漂移。
CREATE TABLE topic (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES topic_run(id) ON DELETE CASCADE,
  topic_key text NOT NULL,
  label text NOT NULL,
  description text NOT NULL,
  -- 平台侧在运行完成时回填的确定计数：COUNT(item_topic)。只读展示，
  -- 核验路径是 /api/topics/:id/items 逐条带证据返回。
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, topic_key)
);

-- 条目 ↔ 主题指派。"某需求被提到 N 次"的唯一权威来源。evidence 必须是
-- 条目原文的逐字子串，worker 落库前硬校验，不合格整条丢弃。
CREATE TABLE item_topic (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES topic_run(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES import_item(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topic(id) ON DELETE CASCADE,
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence text NOT NULL,
  model_band text NOT NULL DEFAULT 'eco' CHECK (model_band IN ('eco', 'standard', 'flagship')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, item_id, topic_id)
);

-- 运行内进度标记（与 classified_at 同理：零指派条目也必须标记已处理，
-- 否则 worker 会重复消费；新一轮运行时因值不同而自动重新参与）。
ALTER TABLE import_item ADD COLUMN topic_assigned_run uuid;

CREATE INDEX topic_run_workspace_idx ON topic_run (workspace_id, created_at DESC);
CREATE INDEX topic_run_idx ON topic (run_id);
CREATE INDEX item_topic_topic_idx ON item_topic (topic_id);
CREATE INDEX item_topic_item_idx ON item_topic (item_id);
CREATE INDEX item_topic_run_idx ON item_topic (run_id, topic_id);

ALTER TABLE topic_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_run FORCE ROW LEVEL SECURITY;
ALTER TABLE topic ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic FORCE ROW LEVEL SECURITY;
ALTER TABLE item_topic ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_topic FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation ON topic_run USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON topic USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation ON item_topic USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
