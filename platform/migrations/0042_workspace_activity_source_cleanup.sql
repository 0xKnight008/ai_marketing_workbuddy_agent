-- Keep financial/security audit records used by recovery. Only expose scheduling
-- and publishing in the workspace activity feed, under the caller's RLS context.
CREATE VIEW workspace_activity_audit WITH (security_invoker = true) AS
 SELECT 'audit:' || id::text AS id, workspace_id, run_id, event_type, payload, created_at
 FROM audit_event
 WHERE workspace_id=current_setting('app.workspace_id',true)::uuid
   AND event_type IN ('feedback.schedule_authorized','feedback.schedule_paused','pipeline.activated',
     'insight.delivery_requested','insight.delivery_approved','insight.delivery_rejected','insight.delivered','insight.delivery_failed')
 UNION ALL
 SELECT 'scan:' || s.id::text, s.workspace_id, NULL::uuid,
   'schedule.' || CASE WHEN r.status IS NOT NULL THEN 'analysis_' || r.status
                      WHEN s.analysis_error IS NOT NULL THEN 'analysis_failed' ELSE s.status END,
   jsonb_build_object('scheduleId',s.schedule_id,'scanId',s.id,'reportId',s.report_id,'name',f.name),
   COALESCE(r.generated_at,s.finished_at,s.created_at)
 FROM feedback_scan s JOIN feedback_schedule f ON f.id=s.schedule_id AND f.workspace_id=s.workspace_id
 LEFT JOIN insight_report r ON r.id=s.report_id AND r.workspace_id=s.workspace_id
 WHERE s.workspace_id=current_setting('app.workspace_id',true)::uuid
 UNION ALL
 SELECT 'run:' || r.id::text, r.workspace_id, r.id, 'publishing.' || r.status::text,
   jsonb_build_object('workflowId',r.workflow_id,'name',w.name), COALESCE(r.finished_at,r.started_at,r.created_at)
 FROM workflow_run r JOIN workflow w ON w.id=r.workflow_id AND w.workspace_id=r.workspace_id
 WHERE r.workspace_id=current_setting('app.workspace_id',true)::uuid
 UNION ALL
 SELECT 'decision:' || id::text,workspace_id,run_id,event_type,
   jsonb_build_object('approvalId',payload->>'approvalId'),created_at
 FROM run_event WHERE workspace_id=current_setting('app.workspace_id',true)::uuid
   AND event_type IN ('approval.approved','approval.rejected');

-- Retain only a small batch tombstone so historical task/report references and
-- credit subjects remain stable. Delete raw items and their cascading tags.
ALTER TABLE import_batch ADD COLUMN deleted_at timestamptz;
ALTER TABLE import_batch ADD COLUMN deleted_by uuid REFERENCES app_user(id);
ALTER TABLE import_batch ADD CONSTRAINT import_deletion_actor CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));
CREATE INDEX import_batch_visible ON import_batch(workspace_id,created_at DESC) WHERE deleted_at IS NULL;
-- Keep small dedup hashes after content deletion, preventing scheduled reimports.
ALTER TABLE feedback_comment ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE feedback_comment DROP CONSTRAINT feedback_comment_item_id_fkey;
ALTER TABLE feedback_comment ADD CONSTRAINT feedback_comment_item_id_fkey FOREIGN KEY(item_id) REFERENCES import_item(id) ON DELETE SET NULL;
CREATE INDEX feedback_comment_item_idx ON feedback_comment(item_id) WHERE item_id IS NOT NULL;
