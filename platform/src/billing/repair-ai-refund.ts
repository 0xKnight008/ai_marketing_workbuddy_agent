import {HttpError} from '../http/errors';
import type {TenantTransaction} from '../foundation/database';
import {refundAiReservations} from './ai-refunds';
/** Operator-only CLI helper. Never mounted as a customer endpoint. */
export async function repairFailedWorkflowRefund(tx:TenantTransaction,runId:string,purchasedCredits:number|undefined,reason:string,apply=false){
 await tx.query(`SELECT workspace_id FROM workspace_billing WHERE workspace_id=current_setting('app.workspace_id')::uuid FOR UPDATE`);
 const run=await tx.query<{status:string;approved:boolean;usable:boolean}>(`SELECT r.status,
   EXISTS(SELECT 1 FROM approval_request a WHERE a.run_id=r.id) AS approved,
   EXISTS(SELECT 1 FROM run_event e WHERE e.run_id=r.id AND e.event_type='action_plan.created' AND COALESCE((e.payload->'actionPlan'->>'blockedByCompliance')::boolean,false)=false) AS usable
   FROM workflow_run r WHERE r.workspace_id=current_setting('app.workspace_id')::uuid AND r.id=$1`,[runId]);
 if(!run.rows[0]||!['failed','dead_lettered'].includes(run.rows[0].status)||run.rows[0].approved||run.rows[0].usable)throw new HttpError(409,'refund_requires_failed_generation_before_approval');
 const rows=await tx.query<{id:string;credits:string;trial:string;purchased:string|null;state:string}>(`SELECT id,ai_credits::text AS credits,trial_ai_credits::text AS trial,purchased_ai_credits::text AS purchased,ai_reservation_state AS state
   FROM task_event WHERE workspace_id=current_setting('app.workspace_id')::uuid AND run_id=$1 AND status='succeeded' AND (action_type='ai' OR action_type LIKE 'ai.%') FOR UPDATE`,[runId]);
 if(rows.rows.length!==1)throw new HttpError(409,'refund_requires_exactly_one_reservation');
 const row=rows.rows[0]!;
 const preview={runId,reservationId:row.id,credits:Number(row.credits),trialCredits:Number(row.trial),purchasedCredits:row.purchased===null?purchasedCredits:Number(row.purchased),state:row.state};
 if(!apply)return {...preview,mode:'preview',refundedCredits:0};
 if(!reason.trim()||reason.length>500)throw new HttpError(400,'refund_audit_reason_required');
 if(row.state==='refunded')return {...preview,mode:'already_refunded',refundedCredits:0};
 if(row.state!=='reserved')throw new HttpError(409,'refund_reservation_already_settled');
 if(row.purchased===null){
   if(purchasedCredits===undefined||!Number.isFinite(purchasedCredits)||purchasedCredits<0||purchasedCredits>Number(row.credits)-Number(row.trial)||Math.abs(purchasedCredits*1000-Math.round(purchasedCredits*1000))>0.000001)throw new HttpError(400,'verified_purchased_credit_allocation_required');
   await tx.query(`UPDATE task_event SET purchased_ai_credits=$2 WHERE id=$1 AND workspace_id=current_setting('app.workspace_id')::uuid`,[row.id,purchasedCredits]);
   await tx.query(`INSERT INTO audit_event(workspace_id,run_id,event_type,payload) VALUES(current_setting('app.workspace_id')::uuid,$1,'ai.historical_refund_allocation',$2)`,[runId,{reservationId:row.id,purchasedCredits,reason}]);
 }
 return {...preview,mode:'applied',refundedCredits:await refundAiReservations(tx,{runId},reason)};
}
