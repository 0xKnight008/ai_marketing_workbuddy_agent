import type {TenantTransaction} from '../foundation/database';
import type {AiUsageSubject} from './guardrails';

function subjectValues(subject: AiUsageSubject) {
  if (!subject.runId && !subject.subjectId) throw new Error('AI refund subject is missing');
  return [subject.runId ?? subject.subjectId, subject.actionType ?? null, subject.attempt ?? null];
}
/** Call in the SAME transaction as durable result persistence. */
export async function settleAiReservations(tx: TenantTransaction, subject: AiUsageSubject): Promise<void> {
  await tx.query(`UPDATE task_event SET ai_reservation_state='settled'
    WHERE workspace_id=current_setting('app.workspace_id')::uuid
      AND (run_id=$1::uuid OR subject_id=$1::uuid) AND ai_reservation_state='reserved'
      AND ($2::text IS NULL OR action_type=$2 OR action_type LIKE $2||'.%')
      AND ($3::integer IS NULL OR attempt=$3)`,subjectValues(subject));
}
/** A terminal generation failure refunds only uncommitted work, once. Supplier
 * cost is NOT reversed: Piggybot may still owe the upstream for failed output.
 * Billing-row first lock order matches reserveAiRun, preventing refund/debit races. */
export async function refundAiReservations(tx: TenantTransaction, subject: AiUsageSubject & {reservationId?:string}, reason: string): Promise<number> {
  await tx.query(`SELECT workspace_id FROM workspace_billing WHERE workspace_id=current_setting('app.workspace_id')::uuid FOR UPDATE`);
  const rows=await tx.query<{id:string;credits:string;trial:string;purchased:string|null;runId:string|null}>(`SELECT id,ai_credits::text AS credits,trial_ai_credits::text AS trial,purchased_ai_credits::text AS purchased,run_id AS "runId"
    FROM task_event WHERE workspace_id=current_setting('app.workspace_id')::uuid
      AND (run_id=$1::uuid OR subject_id=$1::uuid) AND ai_reservation_state='reserved'
      AND ($2::text IS NULL OR action_type=$2 OR action_type LIKE $2||'.%')
      AND ($3::integer IS NULL OR attempt=$3) AND ($4::uuid IS NULL OR id=$4) ORDER BY id FOR UPDATE`,[...subjectValues(subject),subject.reservationId??null]);
  let refunded=0;
  for(const row of rows.rows){
    if(row.purchased===null){
      // Old versions did not store funding buckets. An explicit audited repair
      // supplies that allocation rather than inventing money in a migration.
      await tx.query(`INSERT INTO audit_event(workspace_id,run_id,event_type,payload)
        VALUES(current_setting('app.workspace_id')::uuid,$1,'ai.refund_review_required',$2)`,[row.runId,{reservationId:row.id,reason}]);
      continue;
    }
    const result=await tx.query<{id:string}>(`INSERT INTO task_event(workspace_id,run_id,subject_id,action_type,attempt,billable_units,ai_credits,trial_ai_credits,purchased_ai_credits,supplier_cost_micros,supplier,status,model_band,reversal_of,credit_period)
      SELECT workspace_id,run_id,subject_id,'credit_refund.'||id::text,attempt,0,ai_credits,trial_ai_credits,purchased_ai_credits,0,supplier,'reversed',model_band,id,credit_period
      FROM task_event WHERE id=$1 AND workspace_id=current_setting('app.workspace_id')::uuid
      ON CONFLICT DO NOTHING RETURNING id`,[row.id]);
    if(!result.rowCount) continue;
    await tx.query(`UPDATE workspace_billing SET purchased_ai_credits=purchased_ai_credits+GREATEST(0,$1::numeric-credit_refund_debt),
      credit_refund_debt=GREATEST(0,credit_refund_debt-$1::numeric),
      trial_credit_carryover=LEAST(30,trial_credit_carryover+CASE WHEN subscription_status<>'trialing'
        AND (SELECT created_at FROM task_event WHERE id=$3)>=trial_started_at THEN $2::numeric ELSE 0::numeric END),updated_at=now()
      WHERE workspace_id=current_setting('app.workspace_id')::uuid`,[row.purchased,row.trial,row.id]);
    await tx.query(`UPDATE task_event SET ai_reservation_state='refunded' WHERE id=$1 AND workspace_id=current_setting('app.workspace_id')::uuid`,[row.id]);
    await tx.query(`INSERT INTO audit_event(workspace_id,run_id,event_type,payload) VALUES(current_setting('app.workspace_id')::uuid,$1,'ai.credits_refunded',$2)`,[row.runId,{reservationId:row.id,refundId:result.rows[0]!.id,credits:row.credits,reason}]);
    refunded+=Number(row.credits);
  }
  return refunded;
}

/** Reconcile terminal reservations left behind by a worker crash or lost callback.
 * Called under the billing-row lock before computing a customer's balance. */
export async function reconcileTerminalAiReservations(tx:TenantTransaction):Promise<void>{
 const rows=await tx.query<{id:string;runId:string|null;subjectId:string|null}>(`SELECT e.id,e.run_id AS "runId",e.subject_id AS "subjectId"
  FROM task_event e WHERE e.workspace_id=current_setting('app.workspace_id')::uuid
    AND e.ai_reservation_state='reserved' AND e.purchased_ai_credits IS NOT NULL
    AND (EXISTS(SELECT 1 FROM workflow_run r WHERE r.id=e.run_id AND r.workspace_id=e.workspace_id AND r.status IN ('failed','dead_lettered'))
      OR EXISTS(SELECT 1 FROM job j WHERE j.workspace_id=e.workspace_id AND j.status='dead_lettered' AND
       ((j.kind='prepare_ai_run' AND j.run_id=e.run_id)
         OR (j.kind='task.turn' AND j.payload->>'messageId'=e.subject_id::text)
         OR (j.kind='import.classify' AND j.payload->>'batchId'=e.subject_id::text)
         OR (j.kind='insight.generate' AND j.payload->>'reportId'=e.subject_id::text)
         OR (j.kind='topics.cluster' AND j.payload->>'runId'=e.subject_id::text))))
    AND NOT EXISTS(SELECT 1 FROM job j WHERE j.workspace_id=e.workspace_id AND j.status IN ('queued','running') AND
       ((j.kind='prepare_ai_run' AND j.run_id=e.run_id)
         OR (j.kind='task.turn' AND j.payload->>'messageId'=e.subject_id::text)
         OR (j.kind='import.classify' AND j.payload->>'batchId'=e.subject_id::text)
         OR (j.kind='insight.generate' AND j.payload->>'reportId'=e.subject_id::text)
         OR (j.kind='topics.cluster' AND j.payload->>'runId'=e.subject_id::text)))
    ORDER BY e.id LIMIT 100`);
 for(const row of rows.rows)await refundAiReservations(tx,{runId:row.runId??undefined,subjectId:row.subjectId??undefined,reservationId:row.id},'terminal_reconciliation');
}
