-- Additive task context. Legacy source records and financial/audit ledgers remain intact.
CREATE TABLE workspace_task (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 source_kind text NOT NULL DEFAULT 'conversation' CHECK(source_kind IN ('conversation','report','import','workflow')),
 source_id uuid, parent_task_id uuid,
 goal text NOT NULL CHECK(length(goal) BETWEEN 1 AND 4000),
 persona text NOT NULL DEFAULT 'creators' CHECK(persona IN ('creators','sellers','community-hosts')),
 model_band text NOT NULL DEFAULT 'standard' CHECK(model_band IN ('eco','standard','flagship')),
 language text NOT NULL DEFAULT 'en' CHECK(language IN ('en','zh','es')),
 batch_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(batch_ids)='array'),
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','queued','running','completed','failed')),
 version integer NOT NULL DEFAULT 0, import_fingerprint text, creation_fingerprint text, review jsonb,
 created_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz, archived_by uuid REFERENCES app_user(id), archive_reason text,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,source_kind,source_id),
 FOREIGN KEY(workspace_id,parent_task_id) REFERENCES workspace_task(workspace_id,id),
 CHECK((source_kind='conversation')=(source_id IS NULL)),
 CHECK(archived_at IS NULL OR (archived_by IS NOT NULL AND length(trim(archive_reason)) BETWEEN 3 AND 1000))
);
CREATE INDEX workspace_task_recent ON workspace_task(workspace_id,updated_at DESC,id);
CREATE TABLE workspace_task_message (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigserial NOT NULL, workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 task_id uuid NOT NULL, request_id uuid NOT NULL, role text NOT NULL CHECK(role IN ('user','assistant')),
 content text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'completed' CHECK(status IN ('queued','running','completed','failed')),
 model_band text NOT NULL CHECK(model_band IN ('eco','standard','flagship')),
 steps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(steps)='array'),
 citations jsonb NOT NULL DEFAULT '[]'::jsonb, error text,
 created_by uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,task_id) REFERENCES workspace_task(workspace_id,id) ON DELETE CASCADE,
 UNIQUE(task_id,request_id,role)
);
CREATE INDEX workspace_task_message_thread ON workspace_task_message(workspace_id,task_id,created_at,id);
CREATE TABLE workspace_task_preference (
 workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
 persona text NOT NULL DEFAULT 'creators' CHECK(persona IN ('creators','sellers','community-hosts')),
 model_band text NOT NULL DEFAULT 'standard' CHECK(model_band IN ('eco','standard','flagship')),
 language text NOT NULL DEFAULT 'en' CHECK(language IN ('en','zh','es')), goal text NOT NULL DEFAULT '' CHECK(length(goal)<=4000),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,user_id),
 FOREIGN KEY(workspace_id,user_id) REFERENCES workspace_membership(workspace_id,user_id) ON DELETE CASCADE
);
ALTER TABLE workspace_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_task FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_task_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_task_message FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_task_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_task_preference FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_task USING(workspace_id=current_setting('app.workspace_id',true)::uuid);
CREATE POLICY workspace_isolation ON workspace_task_message USING(workspace_id=current_setting('app.workspace_id',true)::uuid);
CREATE POLICY workspace_isolation ON workspace_task_preference USING(workspace_id=current_setting('app.workspace_id',true)::uuid);
ALTER TABLE feedback_message ADD COLUMN task_id uuid;
ALTER TABLE feedback_message ADD COLUMN task_context jsonb;
ALTER TABLE feedback_message ADD CONSTRAINT feedback_task_workspace FOREIGN KEY(workspace_id,task_id) REFERENCES workspace_task(workspace_id,id);
ALTER TABLE feedback_message ADD CONSTRAINT feedback_task_requires_workspace CHECK(task_id IS NULL OR workspace_id IS NOT NULL);
