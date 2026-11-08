import { z } from 'zod';
import type { ActorContext } from '../contracts/domain';
import type { Database } from '../foundation/database';
import { requirePermission } from '../foundation/rbac';
import { HttpError } from '../http/errors';

/** Purge source content, retain a small tombstone and independent billing/results. */
export async function deleteImport(database: Database, actor: ActorContext, batchId: unknown, body: unknown) {
  requirePermission(actor.role, 'workflow:edit');
  const id = z.string().uuid().parse(batchId);
  z.object({ confirm: z.literal(true) }).strict().parse(body);
  return database.withWorkspace(actor.workspaceId, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`source-content:${actor.workspaceId}`]);
    const batch = await tx.query<{status:string;deletedAt:string|null}>(
      'SELECT status,deleted_at AS "deletedAt" FROM import_batch WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [actor.workspaceId,id],
    );
    if (!batch.rows[0]) throw new HttpError(404,'import_not_found');
    if (batch.rows[0].deletedAt) return {id,deleted:true};
    if (batch.rows[0].status === 'classifying') throw new HttpError(409,'import_in_use');
    // Locks taken by source consumers when submitting work serialize with this
    // tombstone. Never remove evidence from a queued or in-flight paid operation.
    const active = await tx.query(`SELECT 1 WHERE
      EXISTS(SELECT 1 FROM workspace_task WHERE workspace_id=$1 AND batch_ids ? $2 AND status IN ('queued','running')) OR
      EXISTS(SELECT 1 FROM insight_report WHERE workspace_id=$1 AND batch_ids ? $2 AND status IN ('pending','generating')) OR
      EXISTS(SELECT 1 FROM feedback_scan WHERE workspace_id=$1 AND batch_id=$2::uuid AND status IN ('queued','running')) OR
      EXISTS(SELECT 1 FROM topic_run WHERE workspace_id=$1 AND status IN ('pending','proposing','assigning')) OR
      EXISTS(SELECT 1 FROM job j WHERE j.workspace_id=$1 AND j.status IN ('queued','running') AND
        (j.payload->>'batchId'=$2 OR j.payload->>'scanId' IN (SELECT id::text FROM feedback_scan WHERE workspace_id=$1 AND batch_id=$2::uuid)))`,[actor.workspaceId,id]);
    if (active.rowCount) throw new HttpError(409,'import_in_use');
    const topics = await tx.query<{id:string}>(`SELECT DISTINCT t.topic_id AS id FROM item_topic t JOIN import_item i ON i.id=t.item_id AND i.workspace_id=t.workspace_id WHERE i.workspace_id=$1 AND i.batch_id=$2`,[actor.workspaceId,id]);
    const removed = await tx.query('DELETE FROM import_item WHERE workspace_id=$1 AND batch_id=$2',[actor.workspaceId,id]);
    if(topics.rows.length) await tx.query(`UPDATE topic t SET item_count=(SELECT count(*) FROM item_topic it WHERE it.workspace_id=t.workspace_id AND it.topic_id=t.id) WHERE t.workspace_id=$1 AND t.id=ANY($2::uuid[])`,[actor.workspaceId,topics.rows.map(t=>t.id)]);
    await tx.query("UPDATE import_batch SET deleted_at=now(),deleted_by=$3,item_count=0,status='failed' WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,id,actor.actorId]);
    await tx.query("INSERT INTO audit_event(workspace_id,actor_id,event_type,payload) VALUES($1,$2,'import.deleted',$3)",[actor.workspaceId,actor.actorId,{batchId:id,removedItems:removed.rowCount}]);
    return {id,deleted:true};
  });
}
