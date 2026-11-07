-- Explicitly authorized feedback collection / daily analysis. No schedule is enabled by migration.
ALTER TABLE approval_request ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE TABLE approval_content_version (
 workspace_id uuid NOT NULL REFERENCES workspace(id), approval_id uuid NOT NULL REFERENCES approval_request(id),
 version integer NOT NULL, requested_action jsonb NOT NULL, edited_by uuid NOT NULL REFERENCES app_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,approval_id,version)
);
ALTER TABLE insight_report ADD COLUMN goal text NOT NULL DEFAULT '' CHECK(length(goal)<=4000);
ALTER TABLE import_batch DROP CONSTRAINT IF EXISTS import_batch_source_type_check;
ALTER TABLE import_batch ADD CONSTRAINT import_batch_source_type_check CHECK(source_type IN ('csv','paste','link','file','discord','google_sheets','channel_feedback'));
CREATE TABLE feedback_schedule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspace(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),goal text NOT NULL CHECK(length(goal) BETWEEN 1 AND 4000),
 account_ids uuid[] NOT NULL CHECK(cardinality(account_ids) BETWEEN 1 AND 10),
 model_band text NOT NULL CHECK(model_band IN ('eco','standard','flagship')),language text NOT NULL CHECK(language IN ('en','es','zh')),
 local_time time NOT NULL, timezone text NOT NULL, daily_credits integer NOT NULL CHECK(daily_credits BETWEEN 1 AND 10000),
 max_items integer NOT NULL CHECK(max_items BETWEEN 1 AND 2000),
 enabled boolean NOT NULL DEFAULT false, next_run_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES app_user(id), authorized_at timestamptz NOT NULL, version integer NOT NULL DEFAULT 1,
 last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE TABLE feedback_scan (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspace(id),
 requested_range text NOT NULL DEFAULT 'since' CHECK(requested_range IN ('24h','7d','since')),
 request_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES app_user(id),account_ids uuid[] NOT NULL,
 since_at timestamptz NOT NULL,until_at timestamptz NOT NULL DEFAULT now(),max_items integer NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','partial','failed')),
 batch_id uuid REFERENCES import_batch(id), coverage jsonb NOT NULL DEFAULT '[]', item_count integer NOT NULL DEFAULT 0,
 schedule_id uuid, scheduled_date date, report_id uuid REFERENCES insight_report(id),
 schedule_snapshot jsonb, analysis_error text, analysis_accepted_at timestamptz, analysis_accepted_by uuid REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,request_id),UNIQUE(schedule_id,scheduled_date),
 FOREIGN KEY(workspace_id,schedule_id) REFERENCES feedback_schedule(workspace_id,id)
);
CREATE TABLE feedback_source_state (
 workspace_id uuid NOT NULL REFERENCES workspace(id),account_id uuid NOT NULL REFERENCES connected_account(id),
 scope_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 last_success_at timestamptz, checkpoint jsonb, updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,account_id,scope_id)
);
CREATE TABLE feedback_comment (
 workspace_id uuid NOT NULL REFERENCES workspace(id),account_id uuid NOT NULL REFERENCES connected_account(id),
 scope_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 external_id text NOT NULL, content_hash text NOT NULL, item_id uuid NOT NULL REFERENCES import_item(id),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,account_id,scope_id,external_id,content_hash)
);
CREATE INDEX feedback_scan_recent ON feedback_scan(workspace_id,created_at DESC);
CREATE INDEX feedback_schedule_due ON feedback_schedule(next_run_at) WHERE enabled;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['approval_content_version','feedback_schedule','feedback_scan','feedback_source_state','feedback_comment'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY workspace_isolation ON %I USING(workspace_id=current_setting(''app.workspace_id'',true)::uuid) WITH CHECK(workspace_id=current_setting(''app.workspace_id'',true)::uuid)',t);
 END LOOP;
END $$;
-- Disable implicit opt-out daily jobs: all future schedules require explicit authorization.
CREATE OR REPLACE FUNCTION enqueue_daily_ops_reports() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
REVOKE EXECUTE ON FUNCTION enqueue_daily_ops_reports() FROM PUBLIC;
-- Discovery is restricted to IDs; actual reads/mutations still use workspace RLS transactions.
CREATE FUNCTION due_feedback_workspaces() RETURNS TABLE(workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE candidate uuid; previous_workspace text; found_count integer := 0;
BEGIN
 previous_workspace := current_setting('app.workspace_id',true);
 -- Forced RLS also applies to a non-superuser migration owner. Establish the
 -- tenant context explicitly instead of relying on a BYPASSRLS production role.
 FOR candidate IN SELECT w.id FROM workspace w ORDER BY w.id LOOP
  PERFORM set_config('app.workspace_id',candidate::text,true);
  IF EXISTS(SELECT 1 FROM feedback_schedule s WHERE s.workspace_id=candidate AND s.enabled AND s.next_run_at<=now()) THEN
   workspace_id := candidate; RETURN NEXT; found_count := found_count+1;
   EXIT WHEN found_count>=200;
  END IF;
 END LOOP;
 PERFORM set_config('app.workspace_id',COALESCE(previous_workspace,''),true);
END;
$$;
REVOKE EXECUTE ON FUNCTION due_feedback_workspaces() FROM PUBLIC;
