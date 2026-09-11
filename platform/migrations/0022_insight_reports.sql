-- Iteration 2 (P0 templates): insight reports generated from imported,
-- evidence-tagged items. One runtime, three template definitions:
-- content_recap (爆款内容复盘), comment_insights (粉丝评论洞察),
-- product_opportunities (商品机会发现). The report JSON stores the
-- validated structured output; every citation inside was verified
-- platform-side (itemId known + snippet verbatim) before persistence.

CREATE TABLE insight_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  template text NOT NULL CHECK (template IN ('content_recap', 'comment_insights', 'product_opportunities')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'generated', 'failed')),
  model_band text NOT NULL DEFAULT 'eco' CHECK (model_band IN ('eco', 'standard', 'flagship')),
  -- Source import batches (uuid[]) the evidence pack was aggregated from.
  batch_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  -- Validated report body (shape depends on template; citations verbatim-checked).
  report jsonb,
  -- How many LLM citations were dropped by platform-side verbatim validation.
  dropped_citations integer NOT NULL DEFAULT 0 CHECK (dropped_citations >= 0),
  error text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz
);

CREATE INDEX insight_report_workspace_idx ON insight_report (workspace_id, created_at DESC);

ALTER TABLE insight_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_report FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation ON insight_report USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
