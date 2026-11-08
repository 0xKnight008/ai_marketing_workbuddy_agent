import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import type {Client} from 'pg';
import type {Database} from '../src/foundation/database';
import {deleteImport} from '../src/import-service/delete';
import {ImportService} from '../src/import-service/service';
import {TaskService} from '../src/task-service/service';

export async function workspaceCleanupRegression(t:TestContext,client:Client,db:Database){
 const actor={actorId:randomUUID(),workspaceId:randomUUID(),role:'owner' as const};
 await client.query("INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Cleanup tester')",[actor.actorId,actor.actorId+'@cleanup.invalid']);
 await client.query("INSERT INTO workspace(id,name,slug) VALUES($1,'Cleanup',$2)",[actor.workspaceId,actor.workspaceId]);
 await client.query("INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner')",[actor.workspaceId,actor.actorId]);
 const createBatch=async()=> (await client.query("INSERT INTO import_batch(workspace_id,label,source_type,status,item_count,created_by) VALUES($1,'Old source','paste','classified',1,$2) RETURNING id",[actor.workspaceId,actor.actorId])).rows[0].id as string;
 const imports=new ImportService(db,{} as any),tasks=new TaskService(db);
 await t.test('deletion is confirmed, tenant scoped, role gated and blocked for in-flight work',async()=>{
  const id=await createBatch();
  await assert.rejects(deleteImport(db,actor,id,{}));
  await assert.rejects(deleteImport(db,{...actor,role:'viewer'},id,{confirm:true}));
  await assert.rejects(deleteImport(db,{...actor,workspaceId:randomUUID()},id,{confirm:true}));
  await client.query("UPDATE import_batch SET status='classifying' WHERE id=$1",[id]);
  await assert.rejects(deleteImport(db,actor,id,{confirm:true}),{code:'import_in_use'});
  await client.query("UPDATE import_batch SET status='classified' WHERE id=$1",[id]);
  const report=(await client.query("INSERT INTO insight_report(workspace_id,template,title,batch_ids,created_by) VALUES($1,'comment_insights','In progress',$2,$3) RETURNING id",[actor.workspaceId,JSON.stringify([id]),actor.actorId])).rows[0].id;
  await assert.rejects(deleteImport(db,actor,id,{confirm:true}),{code:'import_in_use'});
  await client.query("UPDATE insight_report SET status='failed' WHERE id=$1",[report]);
  const job=(await client.query("INSERT INTO job(workspace_id,kind,payload) VALUES($1,'import.classify',$2) RETURNING id",[actor.workspaceId,{batchId:id}])).rows[0].id;
  await assert.rejects(deleteImport(db,actor,id,{confirm:true}),{code:'import_in_use'});
  await client.query("UPDATE job SET status='succeeded' WHERE id=$1",[job]);
  await deleteImport(db,actor,id,{confirm:true});
 });
 await t.test('purges originals and tags, keeps saved results and billing subjects, and preserves feedback dedup hashes',async()=>{
  const batch=await createBatch();
  const item=(await client.query("INSERT INTO import_item(workspace_id,batch_id,text) VALUES($1,$2,'Original evidence') RETURNING id",[actor.workspaceId,batch])).rows[0].id;
  await client.query("INSERT INTO item_tag(workspace_id,item_id,tag,confidence,evidence) VALUES($1,$2,'suggestion',1,'Original evidence')",[actor.workspaceId,item]);
  const account=(await client.query("INSERT INTO connected_account(workspace_id,provider,external_account_id,display_name) VALUES($1,'zernio',$2,'Read account') RETURNING id",[actor.workspaceId,randomUUID()])).rows[0].id;
  await client.query("INSERT INTO feedback_comment(workspace_id,account_id,external_id,content_hash,item_id) VALUES($1,$2,'external-comment','hash',$3)",[actor.workspaceId,account,item]);
  const report=(await client.query("INSERT INTO insight_report(workspace_id,template,title,status,batch_ids,report,created_by) VALUES($1,'comment_insights','Saved result','generated',$2,$3,$4) RETURNING id",[actor.workspaceId,JSON.stringify([batch]),{summary:'Saved interpretation',citations:[{ref:item,snippet:'Original evidence'}]},actor.actorId])).rows[0].id;
  const task=(await client.query("INSERT INTO workspace_task(workspace_id,goal,batch_ids,status,created_by) VALUES($1,'Saved conversation',$2,'completed',$3) RETURNING id",[actor.workspaceId,JSON.stringify([batch]),actor.actorId])).rows[0].id;
  const topicRun=(await client.query("INSERT INTO topic_run(workspace_id,status,item_count,created_by) VALUES($1,'completed',1,$2) RETURNING id",[actor.workspaceId,actor.actorId])).rows[0].id;
  const topic=(await client.query("INSERT INTO topic(workspace_id,run_id,topic_key,label,description,item_count) VALUES($1,$2,'feedback','Feedback','Topic',1) RETURNING id",[actor.workspaceId,topicRun])).rows[0].id;
  await client.query("INSERT INTO item_topic(workspace_id,run_id,item_id,topic_id,confidence,evidence) VALUES($1,$2,$3,$4,1,'Original evidence')",[actor.workspaceId,topicRun,item,topic]);
  await deleteImport(db,actor,batch,{confirm:true});
  assert.deepEqual(await deleteImport(db,actor,batch,{confirm:true}),{id:batch,deleted:true});
  assert.equal((await client.query('SELECT 1 FROM import_item WHERE batch_id=$1',[batch])).rowCount,0);
  assert.equal((await client.query('SELECT 1 FROM item_tag WHERE item_id=$1',[item])).rowCount,0);
  assert.equal((await client.query('SELECT item_id FROM feedback_comment WHERE account_id=$1',[account])).rows[0].item_id,null);
  assert.equal((await client.query('SELECT item_count FROM topic WHERE id=$1',[topic])).rows[0].item_count,0);
  assert.equal((await client.query('SELECT report FROM insight_report WHERE id=$1',[report])).rows[0].report.summary,'Saved interpretation');
  assert.ok((await client.query('SELECT deleted_at FROM import_batch WHERE id=$1',[batch])).rows[0].deleted_at);
  assert.equal((await imports.listImports(actor)).some(b=>b.id===batch),false);
  await assert.rejects(imports.importDetail(actor,batch),{code:'import_deleted'});
  await assert.rejects(tasks.evidence(actor,task,item),{code:'task_sources_deleted'});
  await assert.rejects(tasks.message(actor,task,{requestId:randomUUID(),message:'Continue analyzing',modelBand:'eco',expectedVersion:0}),{code:'task_sources_deleted'});
 });
 await t.test('database activity view exposes only scheduling and publication while retaining underlying recovery audit',async()=>{
  for(const type of ['auth.logged_in','billing.checkout_created','import.created','feedback.schedule_authorized','feedback.schedule_paused','pipeline.activated'])await client.query('INSERT INTO audit_event(workspace_id,event_type,payload) VALUES($1,$2,$3)',[actor.workspaceId,type,{stripeCheckoutSessionId:'retained-test'}]);
  const workflow=(await client.query("INSERT INTO workflow(workspace_id,name,created_by) VALUES($1,'Published story',$2) RETURNING id",[actor.workspaceId,actor.actorId])).rows[0].id;
  await client.query("INSERT INTO workflow_version(workflow_id,version,definition,created_by) VALUES($1,1,'{}',$2)",[workflow,actor.actorId]);
  await client.query("INSERT INTO workflow_run(workspace_id,workflow_id,workflow_version,status,idempotency_key,input,context_snapshot,requested_by) VALUES($1,$2,1,'succeeded',$3,'{}','{}',$4)",[actor.workspaceId,workflow,randomUUID(),actor.actorId]);
  const schedule=(await client.query("INSERT INTO feedback_schedule(workspace_id,name,goal,account_ids,model_band,language,local_time,timezone,daily_credits,max_items,next_run_at,created_by,authorized_at) VALUES($1,'Daily feedback','Summarize',ARRAY[$2::uuid],'eco','en','09:00','UTC',5,10,now(),$3,now()) RETURNING id",[actor.workspaceId,randomUUID(),actor.actorId])).rows[0].id;
  await client.query("INSERT INTO feedback_scan(workspace_id,request_id,created_by,account_ids,since_at,max_items,status,schedule_id,finished_at) VALUES($1,$2,$3,ARRAY[$4::uuid],now(),10,'completed',$5,now())",[actor.workspaceId,randomUUID(),actor.actorId,randomUUID(),schedule]);
  const result=await db.withWorkspace(actor.workspaceId,tx=>tx.query('SELECT * FROM workspace_activity_audit'));
  assert.deepEqual(result.rows.map(r=>r.event_type).sort(),['feedback.schedule_authorized','feedback.schedule_paused','pipeline.activated','publishing.succeeded','schedule.completed'].sort());
  assert.equal((await client.query("SELECT 1 FROM audit_event WHERE workspace_id=$1 AND event_type='billing.checkout_created'",[actor.workspaceId])).rowCount,1);
  // Exercise the view under a non-owner role, not the test database superuser.
  const role='cleanup_reader_'+randomUUID().replace(/-/g,'');
  await client.query('BEGIN');
  try{
   await client.query(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
   await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
   await client.query(`GRANT SELECT ON workspace_activity_audit,audit_event,feedback_scan,feedback_schedule,insight_report,workflow_run,workflow,run_event TO ${role}`);
   await client.query(`SET LOCAL ROLE ${role}`);
   await client.query("SELECT set_config('app.workspace_id',$1,true)",[actor.workspaceId]);
   assert.equal((await client.query('SELECT * FROM workspace_activity_audit')).rowCount,5);
   await client.query("SELECT set_config('app.workspace_id',$1,true)",[randomUUID()]);
   assert.equal((await client.query('SELECT * FROM workspace_activity_audit')).rowCount,0);
  }finally{await client.query('ROLLBACK');}
 });
}
