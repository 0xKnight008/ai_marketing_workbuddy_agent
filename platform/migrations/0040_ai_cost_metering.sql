-- Additive; old task_event and 0039 refunds retain their meaning.
CREATE TABLE ai_cost_operation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspace(id),
 actor_id uuid NOT NULL, kind text NOT NULL, band text NOT NULL CHECK(band IN ('eco','standard','flagship')),
 policy_version text NOT NULL DEFAULT 'cost-v1', mode text NOT NULL DEFAULT 'cost-v1' CHECK(mode IN ('shadow','cost-v1')), rate jsonb NOT NULL,
 estimated_credits integer NOT NULL CHECK(estimated_credits>=0), max_credits integer NOT NULL CHECK(max_credits>0),
 max_calls integer NOT NULL CHECK(max_calls BETWEEN 1 AND 10001), subject_id uuid,
 accepted_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 created_at timestamptz NOT NULL DEFAULT now(), credit_period date,
 state text NOT NULL DEFAULT 'quoted' CHECK(state IN ('quoted','accepted','reserved','settled','refunded','reconciliation')),
 settled_credits integer NOT NULL DEFAULT 0 CHECK(settled_credits>=0), valid_cost_nanos bigint NOT NULL DEFAULT 0 CHECK(valid_cost_nanos>=0),
 held_credits integer NOT NULL DEFAULT 0 CHECK(held_credits<=max_credits), hold_trial numeric(12,3) NOT NULL DEFAULT 0,
 hold_purchased numeric(12,3) NOT NULL DEFAULT 0,
 CHECK(settled_credits<=max_credits), CHECK(held_credits>=0),
 UNIQUE(workspace_id,id)
);
CREATE TABLE ai_cost_request (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, operation_id uuid NOT NULL,
 action_type text NOT NULL, attempt integer NOT NULL, generation integer NOT NULL DEFAULT 1,
 max_cost_nanos bigint NOT NULL CHECK(max_cost_nanos>=0), state text NOT NULL DEFAULT 'reserved',
 created_at timestamptz NOT NULL DEFAULT now(), valid_at timestamptz,
 UNIQUE(workspace_id,operation_id,action_type,attempt,generation),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,operation_id) REFERENCES ai_cost_operation(workspace_id,id),
 CHECK(state IN ('reserved','received','valid','failed','unknown'))
);
CREATE TABLE ai_cost_receipt (
 workspace_id uuid NOT NULL, id uuid NOT NULL, operation_id uuid NOT NULL, request_id uuid NOT NULL,
 model text NOT NULL, prompt_tokens integer, completion_tokens integer, cached_tokens integer,
 cost_nanos bigint, started_at timestamptz, status text NOT NULL CHECK(status IN ('known','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,request_id) REFERENCES ai_cost_request(workspace_id,id),
 CHECK(cost_nanos IS NULL OR cost_nanos>=0)
);
CREATE TABLE ai_cost_journal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,operation_id uuid NOT NULL,
 event_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('reserve','settle','release','refund')),
 credits numeric(12,3) NOT NULL CHECK(credits>=0),trial numeric(12,3) NOT NULL DEFAULT 0,
 purchased numeric(12,3) NOT NULL DEFAULT 0,credit_period date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,operation_id,event_key),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES ai_cost_operation(workspace_id,id)
);
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['ai_cost_operation','ai_cost_request','ai_cost_receipt','ai_cost_journal'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',relation);
 EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (workspace_id=current_setting(''app.workspace_id'',true)::uuid)',relation);
 END LOOP;
END $$;
CREATE INDEX ai_cost_operation_subject ON ai_cost_operation(workspace_id,subject_id);
CREATE INDEX ai_cost_operation_pending ON ai_cost_operation(workspace_id,state,created_at);
CREATE INDEX ai_cost_receipt_period ON ai_cost_receipt(workspace_id,created_at);

CREATE UNIQUE INDEX ai_cost_one_active_subject ON ai_cost_operation(workspace_id,subject_id) WHERE state IN ('accepted','reserved','reconciliation');
CREATE TABLE ai_cost_legacy_subject(workspace_id uuid NOT NULL,subject_id uuid NOT NULL,PRIMARY KEY(workspace_id,subject_id));
ALTER TABLE ai_cost_legacy_subject ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_cost_legacy_subject FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON ai_cost_legacy_subject USING(workspace_id=current_setting('app.workspace_id',true)::uuid);
-- Global migration owner may not bypass forced tenant RLS. Seed per workspace.
DO $$ DECLARE w uuid; BEGIN
 FOR w IN SELECT id FROM workspace LOOP
 PERFORM set_config('app.workspace_id',w::text,true);
 INSERT INTO ai_cost_legacy_subject(workspace_id,subject_id)
 SELECT workspace_id,id FROM workflow_run WHERE workspace_id=w
 UNION SELECT workspace_id,id FROM import_batch WHERE workspace_id=w
 UNION SELECT workspace_id,id FROM insight_report WHERE workspace_id=w
 UNION SELECT workspace_id,id FROM topic_run WHERE workspace_id=w
 UNION SELECT workspace_id,id FROM workspace_task_message WHERE workspace_id=w
 ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
