import type { Database } from "../foundation/database";
/** Fail deployment readiness when the actual configured database lacks phase-two columns. */
export async function assertTaskSchema(database: Pick<Database, "withAdmin">) {
  await database.withAdmin(async (tx) => {
    await tx.query("SET LOCAL statement_timeout='5s'");
    await tx.query(
      "SELECT id,review,creation_fingerprint,import_fingerprint,archived_at FROM workspace_task LIMIT 0",
    );
    await tx.query(
      "SELECT id,sequence,steps,citations FROM workspace_task_message LIMIT 0",
    );
    await tx.query(
      "SELECT workspace_id,user_id,goal FROM workspace_task_preference LIMIT 0",
    );
    await tx.query("SELECT id,deleted_at,deleted_by FROM import_batch LIMIT 0");
    await tx.query("SELECT id,event_type FROM workspace_activity_audit LIMIT 0");
    await tx.query("SELECT id,version FROM approval_request LIMIT 0");
    await tx.query("SELECT id,goal FROM insight_report LIMIT 0");
    await tx.query("SELECT id,enabled,daily_credits,next_run_at FROM feedback_schedule LIMIT 0");
    await tx.query("SELECT id,coverage,schedule_snapshot FROM feedback_scan LIMIT 0");
    await tx.query("SELECT scope_id,checkpoint FROM feedback_source_state LIMIT 0");
    await tx.query("SELECT scope_id,content_hash FROM feedback_comment LIMIT 0");
    await tx.query("SELECT task_id,task_context FROM feedback_message LIMIT 0");
  });
}
