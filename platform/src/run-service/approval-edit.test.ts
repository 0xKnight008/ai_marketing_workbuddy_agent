import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {TenantTransaction} from '../foundation/database';
import {editApproval} from './approval-edit';
test('manual pipeline edits preserve targets, enforce existing limits and retain the original snapshot',async()=>{
 const actor={workspaceId:randomUUID(),actorId:randomUUID(),role:'owner' as const},id=randomUUID();
 const original={summary:'Publish',requiresApproval:true,actions:[{stepOrder:1,type:'social.create_post',platform:'x',accountId:'same-account',content:'Original',hashtags:['#test'],idempotencyKey:'same-key',requiresApproval:true}]};
 const writes:Array<{sql:string;values:readonly unknown[]|undefined}>=[];
 const tx={query:async(sql:string,values?:readonly unknown[])=>{if(sql.startsWith('SELECT version'))return {rows:[{version:1,status:'pending',runId:randomUUID(),action:original}],rowCount:1};if(sql.startsWith('SELECT context_snapshot'))return {rows:[{context:{forbiddenWords:['forbidden']}}],rowCount:1};writes.push({sql,values});return {rows:[],rowCount:1}}} as unknown as TenantTransaction;
 await assert.rejects(editApproval(tx,actor,id,{expectedVersion:1,actions:[{stepOrder:1,content:'x'.repeat(280)}]}),/approval_content_too_long/);
 await assert.rejects(editApproval(tx,actor,id,{expectedVersion:1,actions:[{stepOrder:1,content:'Forbidden statement'}]}),/approval_content_forbidden_word/);
 await assert.rejects(editApproval(tx,actor,id,{expectedVersion:1,actions:[{stepOrder:1,content:'Edited',accountId:'different'}]}));assert.equal(writes.length,0);
 const result=await editApproval(tx,actor,id,{expectedVersion:1,actions:[{stepOrder:1,content:'Reviewed'}]});assert.equal(result.version,2);assert.equal(result.requestedAction.actions[0].accountId,'same-account');assert.equal(result.requestedAction.actions[0].idempotencyKey,'same-key');assert.equal(original.actions[0]!.content,'Original');assert.ok(writes.some(w=>w.sql.startsWith('INSERT INTO approval_content_version')));
});
