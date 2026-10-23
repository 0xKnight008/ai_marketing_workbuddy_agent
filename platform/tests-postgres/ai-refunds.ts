import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import type {Client} from 'pg';
import type {Database} from '../src/foundation/database';
import {refundAiReservations,settleAiReservations} from '../src/billing/ai-refunds';
import {reserveAiRun,usageSnapshot} from '../src/billing/guardrails';
import {repairFailedWorkflowRefund} from '../src/billing/repair-ai-refund';
import {ingestAiRuntimeEvent} from '../src/run-service/repository';

export async function aiRefundRegression(t:TestContext,client:Client,db:Database){
 const workspaceId=randomUUID(),actorId=randomUUID(),workflowId=randomUUID();
 await client.query("INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Refund tester')",[actorId,`${actorId}@example.invalid`]);
 await client.query("INSERT INTO workspace(id,name,slug) VALUES($1,'Refund tests',$2)",[workspaceId,`refund-${workspaceId}`]);
 await client.query("INSERT INTO workspace_billing(workspace_id,period_start,plan,subscription_status) VALUES($1,date_trunc('month',now())::date,'creator','active')",[workspaceId]);
 await client.query("INSERT INTO workflow(id,workspace_id,name,created_by) VALUES($1,$2,'Refund workflow',$3)",[workflowId,workspaceId,actorId]);
 await client.query("INSERT INTO workflow_version(workflow_id,version,definition,created_by) VALUES($1,1,'{}',$2)",[workflowId,actorId]);
 const reset=async()=>{await client.query('DELETE FROM task_event WHERE workspace_id=$1',[workspaceId]);await client.query("UPDATE workspace_billing SET subscription_status='active',purchased_ai_credits=100,trial_credit_carryover=0,trial_started_at=NULL,trial_ends_at=NULL,trial_credit_handoff_pending=false WHERE workspace_id=$1",[workspaceId]);};
 const available=()=>db.withWorkspace(workspaceId,usageSnapshot);
 await t.test('20-credit failure refunds once under concurrent callbacks and charges again on explicit retry',async()=>{
  await reset();const subjectId=randomUUID();const baseline=await available();
  await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],{subjectId,actionType:'ai.task'},'flagship'));
  assert.equal((await available()).aiCreditsAvailable,baseline.aiCreditsAvailable-20);
  const refunds=await Promise.all([1,2].map(()=>db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId},'provider_auth'))));
  assert.equal(refunds.reduce((a,b)=>a+b),20);assert.equal((await available()).aiCreditsAvailable,baseline.aiCreditsAvailable);
  const cost=await client.query('SELECT supplier_cost_micros,status FROM task_event WHERE workspace_id=$1 ORDER BY status',[workspaceId]);
  assert.equal(Number(cost.rows.find(r=>r.status==='reversed').supplier_cost_micros),0);
  assert.ok(Number(cost.rows.find(r=>r.status==='succeeded').supplier_cost_micros)>0);
  const retry=await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],{subjectId,actionType:'ai.task'},'flagship'));assert.equal(retry.charged,true);assert.equal(retry.replayed,false);
  const replay=await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],{subjectId,actionType:'ai.task'},'flagship'));assert.equal(replay.replayed,true);assert.equal((await available()).aiCreditsAvailable,baseline.aiCreditsAvailable-20);
  await db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId},'second_failure'));
  assert.equal((await available()).aiCreditsAvailable,baseline.aiCreditsAvailable);
 });
 await t.test('mixed free, included and purchased buckets return to their original balances',async()=>{
  await reset();await client.query("UPDATE workspace_billing SET trial_credit_carryover=4,trial_started_at=now()-interval '1 day' WHERE workspace_id=$1",[workspaceId]);
  await client.query("INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status,ai_reservation_state,purchased_ai_credits) VALUES($1,$2,'ai.seed',0,390,'succeeded','settled',0)",[workspaceId,randomUUID()]);
  const subjectId=randomUUID(),before=await available();
  await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],{subjectId},'flagship'));
  let billing=await client.query('SELECT purchased_ai_credits,trial_credit_carryover FROM workspace_billing WHERE workspace_id=$1',[workspaceId]);assert.equal(Number(billing.rows[0].purchased_ai_credits),94);assert.equal(Number(billing.rows[0].trial_credit_carryover),0);
  await db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId},'failed'));
  billing=await client.query('SELECT purchased_ai_credits,trial_credit_carryover FROM workspace_billing WHERE workspace_id=$1',[workspaceId]);assert.equal(Number(billing.rows[0].purchased_ai_credits),100);assert.equal(Number(billing.rows[0].trial_credit_carryover),4);assert.equal((await available()).aiCreditsAvailable,before.aiCreditsAvailable);
 });
 await t.test('trial refund and a later paid handoff do not consume paid allowance',async()=>{
  await reset();await client.query("UPDATE workspace_billing SET subscription_status='trialing',trial_started_at=now()-interval '1 day',trial_ends_at=now()+interval '1 day' WHERE workspace_id=$1",[workspaceId]);
  const subjectId=randomUUID();await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],{subjectId},'flagship'));
  assert.equal((await available()).aiCreditsAvailable,10);
  await db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId},'failed'));assert.equal((await available()).aiCreditsAvailable,30);
  const second=randomUUID();await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],{subjectId:second},'flagship'));
  await client.query("UPDATE workspace_billing SET subscription_status='active',trial_credit_carryover=10 WHERE workspace_id=$1",[workspaceId]);
  await db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId:second},'late_failure'));assert.equal((await available()).trialCreditCarryover,30);assert.equal((await available()).aiCreditsUsed,0);
 });
 await t.test('prior-month refunds restore purchased balance without granting new monthly credits',async()=>{
  await reset();const subjectId=randomUUID();
  await client.query("INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status,ai_reservation_state,purchased_ai_credits,credit_period,created_at) VALUES($1,$2,'ai',0,20,'succeeded','reserved',20,(date_trunc('month',now())-interval '1 month')::date,now()-interval '1 month')",[workspaceId,subjectId]);
  const before=await available();await db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId},'late_failure'));
  assert.equal((await available()).aiCreditsUsed,0);assert.equal((await available()).aiCreditsAvailable,before.aiCreditsAvailable+20);
 });
 await t.test('settled output remains paid when later delivery fails; tenant isolation prevents refunds',async()=>{
  await reset();const subjectId=randomUUID();await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['standard'],{subjectId},'standard'));
  assert.equal(await db.withWorkspace(randomUUID(),tx=>refundAiReservations(tx,{subjectId},'other_tenant')),0);
  await db.withWorkspace(workspaceId,tx=>settleAiReservations(tx,{subjectId}));assert.equal(await db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId},'delivery_failed')),0);
 });
 await t.test('runtime auth failure callback refunds 20 exactly once and keeps the failed status',async()=>{
  await reset();const runId=randomUUID(),aiRunId=randomUUID();
  await client.query("INSERT INTO workflow_run(id,workspace_id,workflow_id,workflow_version,idempotency_key,input,context_snapshot,requested_by,status) VALUES($1,$2,$3,1,$1::uuid::text,'{}','{}',$4,'running')",[runId,workspaceId,workflowId,actorId]);
  await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],runId,'flagship'));
  const event={eventId:randomUUID(),platformRunId:runId,workspaceId,aiRunId,type:'ai_run.failed' as const,createdAt:new Date().toISOString(),payload:{error:'401 invalid token'}};
  await Promise.all([1,2].map(()=>db.withWorkspace(workspaceId,tx=>ingestAiRuntimeEvent(tx,event))));
  assert.equal((await client.query("SELECT count(*)::int AS n FROM task_event WHERE run_id=$1 AND reversal_of IS NOT NULL",[runId])).rows[0].n,1);
  assert.equal((await available()).aiCreditsAvailable,500);assert.equal((await client.query('SELECT status FROM workflow_run WHERE id=$1',[runId])).rows[0].status,'failed');
 });
 await t.test('unknown historical funding is flagged for audited repair without inventing a purchased balance',async()=>{
  await reset();const subjectId=randomUUID();await client.query("INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status,ai_reservation_state) VALUES($1,$2,'ai',0,20,'succeeded','reserved')",[workspaceId,subjectId]);
  assert.equal(await db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId},'historic')),0);assert.equal((await available()).aiCreditsAvailable,480);
 });
 await t.test('historical 20-credit repair previews, requires a verified allocation and applies once',async()=>{
  await reset();const runId=randomUUID();await client.query("INSERT INTO workflow_run(id,workspace_id,workflow_id,workflow_version,idempotency_key,input,context_snapshot,requested_by,status) VALUES($1,$2,$3,1,$1::uuid::text,'{}','{}',$4,'failed')",[runId,workspaceId,workflowId,actorId]);
  await client.query("INSERT INTO task_event(workspace_id,run_id,action_type,billable_units,ai_credits,status,ai_reservation_state) VALUES($1,$2,'ai',0,20,'succeeded','reserved')",[workspaceId,runId]);
  const preview=await db.withWorkspace(workspaceId,tx=>repairFailedWorkflowRefund(tx,runId,undefined,'',false));assert.equal(preview.credits,20);assert.equal((await available()).aiCreditsAvailable,480);
  await assert.rejects(db.withWorkspace(workspaceId,tx=>repairFailedWorkflowRefund(tx,runId,undefined,'Verified failed generation',true)),/verified_purchased/);
  const apply=await db.withWorkspace(workspaceId,tx=>repairFailedWorkflowRefund(tx,runId,0,'Verified included-plan allocation; upstream auth failure',true));assert.equal(apply.refundedCredits,20);assert.equal((await available()).aiCreditsAvailable,500);
  const replay=await db.withWorkspace(workspaceId,tx=>repairFailedWorkflowRefund(tx,runId,0,'Same repair request',true));assert.equal(replay.refundedCredits,0);
  await client.query("UPDATE workflow_run SET status='waiting_approval' WHERE id=$1",[runId]);await assert.rejects(db.withWorkspace(workspaceId,tx=>repairFailedWorkflowRefund(tx,runId,0,'Not eligible',true)),/before_approval/);
 });

 await t.test('a crashed terminal worker is reconciled on balance read, but a queued retry is not refunded',async()=>{
  await reset();const subjectId=randomUUID();await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],{subjectId,actionType:'ai.task'},'flagship'));
  const jobId=randomUUID();await client.query("INSERT INTO job(id,workspace_id,kind,payload,status) VALUES($1,$2,'task.turn',$3,'queued')",[jobId,workspaceId,{messageId:subjectId}]);
  assert.equal((await available()).aiCreditsAvailable,480);
  await client.query("UPDATE job SET status='dead_lettered' WHERE id=$1",[jobId]);assert.equal((await available()).aiCreditsAvailable,500);assert.equal((await available()).aiCreditsAvailable,500);
 });

 for(const blocked of [true,false])await t.test(`workflow output blocked=${blocked} settles or refunds before approval without bypassing review`,async()=>{
  await reset();const runId=randomUUID(),aiRunId=randomUUID();await client.query("INSERT INTO workflow_run(id,workspace_id,workflow_id,workflow_version,idempotency_key,input,context_snapshot,requested_by,status) VALUES($1,$2,$3,1,$1::uuid::text,'{}','{}',$4,'running')",[runId,workspaceId,workflowId,actorId]);
  await db.withWorkspace(workspaceId,tx=>reserveAiRun(tx,['flagship'],runId,'flagship'));
  const event={eventId:randomUUID(),platformRunId:runId,workspaceId,aiRunId,type:'action_plan.created' as const,createdAt:new Date().toISOString(),payload:{actionPlan:{summary:'Draft',requiresApproval:true,blockedByCompliance:blocked,actions:[{stepOrder:1,type:'social.create_post',platform:'x',accountId:'synthetic-account',content:'A synthetic draft',hashtags:[],mode:'publish_now',idempotencyKey:runId,requiresApproval:true}]}}};
  await db.withWorkspace(workspaceId,tx=>ingestAiRuntimeEvent(tx,event));
  const ledger=await client.query('SELECT ai_reservation_state FROM task_event WHERE run_id=$1 AND reversal_of IS NULL',[runId]);assert.equal(ledger.rows[0].ai_reservation_state,blocked?'refunded':'settled');
  const approvals=await client.query('SELECT count(*)::int AS n FROM approval_request WHERE run_id=$1',[runId]);assert.equal(approvals.rows[0].n,blocked?0:1);
  // A delayed failure must not refund a valid plan already waiting for approval.
  await db.withWorkspace(workspaceId,tx=>ingestAiRuntimeEvent(tx,{...event,eventId:randomUUID(),type:'ai_run.failed',payload:{error:'late error'}}));
  assert.equal((await available()).aiCreditsAvailable,blocked?500:480);
 });
 await t.test('a purchased-credit refund clears topup chargeback debt before creating spendable credits',async()=>{
  await reset();const subjectId=randomUUID();await client.query("INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status,ai_reservation_state,purchased_ai_credits) VALUES($1,$2,'ai',0,20,'succeeded','reserved',20)",[workspaceId,subjectId]);
  await client.query('UPDATE workspace_billing SET purchased_ai_credits=0,credit_refund_debt=15 WHERE workspace_id=$1',[workspaceId]);
  await db.withWorkspace(workspaceId,tx=>refundAiReservations(tx,{subjectId},'failed'));const b=(await client.query('SELECT purchased_ai_credits,credit_refund_debt FROM workspace_billing WHERE workspace_id=$1',[workspaceId])).rows[0];assert.equal(Number(b.purchased_ai_credits),5);assert.equal(Number(b.credit_refund_debt),0);
 });

}

/** Seed the exact pre-0039 schema; verify the incremental migration on real data. */
export async function legacyRefundMigrationFixture(client:Client){
 const workspaceId=randomUUID(),actorId=randomUUID(),workflowId=randomUUID();
 await client.query("INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Legacy refund migration')",[actorId,`${actorId}@example.invalid`]);
 await client.query("INSERT INTO workspace(id,name,slug) VALUES($1,'Legacy refund migration',$2)",[workspaceId,`legacy-refund-${workspaceId}`]);
 await client.query("INSERT INTO workflow(id,workspace_id,name,created_by) VALUES($1,$2,'Legacy workflow',$3)",[workflowId,workspaceId,actorId]);
 await client.query("INSERT INTO workflow_version(workflow_id,version,definition,created_by) VALUES($1,1,'{}',$2)",[workflowId,actorId]);
 const ids=[] as string[];
 for(const status of ['failed','waiting_approval','failed']){
  const runId=randomUUID();ids.push(runId);await client.query("INSERT INTO workflow_run(id,workspace_id,workflow_id,workflow_version,idempotency_key,input,context_snapshot,requested_by,status) VALUES($1,$2,$3,1,$1::uuid::text,'{}','{}',$4,$5)",[runId,workspaceId,workflowId,actorId,status]);
  await client.query("INSERT INTO task_event(workspace_id,run_id,action_type,billable_units,ai_credits,supplier_cost_micros,status,created_at) VALUES($1,$2,'ai',0,20,100000,'succeeded',now()-interval '1 month')",[workspaceId,runId]);
 }
 await client.query("INSERT INTO approval_request(workspace_id,run_id,status,requested_action) VALUES($1,$2,'pending','{}')",[workspaceId,ids[1]]);
 await client.query("INSERT INTO run_event(workspace_id,run_id,event_key,event_type,payload) VALUES($1,$2,'valid-plan','action_plan.created','{\"actionPlan\":{\"blockedByCompliance\":false}}')",[workspaceId,ids[2]]);
 return async()=>{
  const result=await client.query("SELECT run_id,ai_credits,purchased_ai_credits,ai_reservation_state,credit_period=date_trunc('month',created_at)::date AS same_period FROM task_event WHERE workspace_id=$1",[workspaceId]);
  assert.equal(result.rows.length,3);
  for(const row of result.rows){assert.equal(Number(row.ai_credits),20);assert.equal(row.purchased_ai_credits,null);assert.equal(row.same_period,true);assert.equal(row.ai_reservation_state,row.run_id===ids[0]?'reserved':'settled');}
 };
}
