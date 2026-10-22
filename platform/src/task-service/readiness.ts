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
    await tx.query("SELECT task_id,task_context FROM feedback_message LIMIT 0");
  });
}
