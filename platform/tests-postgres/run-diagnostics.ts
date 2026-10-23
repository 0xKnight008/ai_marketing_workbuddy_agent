import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import type {Client} from 'pg';
import type {Database} from '../src/foundation/database';
import {PlatformService} from '../src/egg/platform-service';
import {TaskService} from '../src/task-service/service';
import type {GatewayConfig} from '../src/foundation/platform-config';
import type {PlatformOrm} from '../src/foundation/sequelize';
import type {ActorContext} from '../src/contracts/domain';
export async function runDiagnosticsRegression(t:TestContext,client:Client,database:Database){
 const owner:ActorContext={actorId:randomUUID(),workspaceId:randomUUID(),role:'owner'},other:ActorContext={actorId:randomUUID(),workspaceId:randomUUID(),role:'owner'};
 for(const a of [owner,other]){
  await client.query("INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Diagnostics tester')",[a.actorId,`${a.actorId}@example.invalid`]);
  await client.query("INSERT INTO workspace(id,name,slug) VALUES($1,'Diagnostics',$2)",[a.workspaceId,`diag-${a.workspaceId}`]);
  await client.query("INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner')",[a.workspaceId,a.actorId]);
 }
 const workflowId=randomUUID(),runId=randomUUID(),taskId=randomUUID();
 await client.query("INSERT INTO workflow(id,workspace_id,name,created_by) VALUES($1,$2,'Diagnostic workflow',$3)",[workflowId,owner.workspaceId,owner.actorId]);
 await client.query("INSERT INTO workflow_version(workflow_id,version,definition,created_by) VALUES($1,1,'{}',$2)",[workflowId,owner.actorId]);
 await client.query("INSERT INTO workflow_run(id,workspace_id,workflow_id,workflow_version,idempotency_key,input,context_snapshot,requested_by,status) VALUES($1,$2,$3,1,'diagnostic','{\"modelBand\":\"flagship\"}','{}',$4,'failed')",[runId,owner.workspaceId,workflowId,owner.actorId]);
 // Existing wrappers defaulted to Standard even when the original selection was Flagship.
 await client.query("INSERT INTO workspace_task(id,workspace_id,source_kind,source_id,goal,created_by) VALUES($1,$2,'workflow',$3,'Draft announcement',$4)",[taskId,owner.workspaceId,runId,owner.actorId]);
 await client.query("INSERT INTO run_event(workspace_id,run_id,event_key,event_type,payload) VALUES($1,$2,'failed','ai_run.failed',$3)",[owner.workspaceId,runId,{error:'401 invalid token Bearer sk-private'}]);
 const service=new PlatformService({} as GatewayConfig,database,{} as PlatformOrm);
 await t.test('canonical task and original run IDs resolve the same scoped execution and safe failure reason',async()=>{
  const byTask=await service.run(owner,taskId) as any,byRun=await service.run(owner,runId) as any;
  assert.equal(byTask.id,runId);assert.equal(byRun.id,runId);assert.equal(byTask.modelBand,'flagship');assert.equal(byTask.failure.kind,'provider_auth');assert.ok(!JSON.stringify(byTask).includes('sk-private'));
 });
 await t.test('legacy task metadata reflects its persisted workflow choice rather than the wrapper default',async()=>{
  const tasks=new TaskService(database);assert.equal((await tasks.detail(owner,taskId)).task.modelBand,'flagship');
  await client.query("UPDATE workflow_run SET input='{\"modelBand\":\"standard\"}' WHERE id=$1",[runId]);assert.equal((await tasks.detail(owner,taskId)).task.modelBand,'standard');
 });
 await t.test('task ID aliases cannot expose another workspace run or its generated content',async()=>{
  assert.equal(await service.run(other,taskId),undefined);assert.equal(await service.run(other,runId),undefined);
 });
}
