import type {TenantTransaction} from '../foundation/database';

/** Both ledgers are immutable history. Settlements consume an existing hold;
 * they are not a second debit. Never include shadow estimates as customer charges. */
export async function billingActivity(tx:TenantTransaction,workspaceId:string){
 const result=await tx.query(`
  SELECT * FROM (
   SELECT e.id::text AS id,e.run_id AS "runId",e.subject_id AS "subjectId",
    e.action_type AS "actionType",e.billable_units AS "billableUnits",
    e.ai_credits::text AS "aiCredits",e.ai_reservation_state AS "reservationState",
    e.reversal_of::text AS "reversalOf",e.status,e.created_at AS "createdAt",
    'legacy'::text AS "ledgerSource",NULL::text AS "journalKind",NULL::uuid AS "operationId"
   FROM task_event e WHERE e.workspace_id=$1
   UNION ALL
   SELECT 'cost:'||j.id::text,r.id,o.subject_id,'ai.'||o.kind,0,j.credits::text,
    CASE j.kind WHEN 'reserve' THEN 'reserved' WHEN 'settle' THEN 'settled'
     WHEN 'release' THEN 'released' ELSE 'refunded' END,NULL::text,
    CASE WHEN j.kind IN ('release','refund') THEN 'reversed' ELSE 'posted' END,
    j.created_at,'cost-v1',j.kind,o.id
   FROM ai_cost_journal j JOIN ai_cost_operation o
    ON o.workspace_id=j.workspace_id AND o.id=j.operation_id
   LEFT JOIN workflow_run r ON r.workspace_id=o.workspace_id AND r.id=o.subject_id
   WHERE j.workspace_id=$1 AND o.mode='cost-v1' AND j.credits>0
  ) activity ORDER BY "createdAt" DESC,id DESC LIMIT 100`,[workspaceId]);
 return result.rows;
}
