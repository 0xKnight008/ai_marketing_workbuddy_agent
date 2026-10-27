import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {randomUUID} from 'node:crypto';
import {createTraceStore,requestTraceContext,tracedModelFetch} from './request-trace';
test('proxy call correlation persists only whitelisted metadata, with JSON mode and no hidden retries',async()=>{
 const previous=process.env.AI_MODEL_ROUTING_MODE;process.env.AI_MODEL_ROUTING_MODE='litellm';
 const db=createClient({url:'file::memory:'});const store=createTraceStore(db);
 const trace={requestId:randomUUID(),taskId:randomUUID(),workspaceId:randomUUID(),operationId:randomUUID(),band:'standard',attempts:[] as Record<string,unknown>[]};
 let calls=0;
 try{
 await requestTraceContext.run(trace,()=>tracedModelFetch(async(_url,init)=>{
  calls++;const body=JSON.parse(String(init?.body));assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.strictJsonSchema,undefined);assert.equal(body.metadata.piggybot_task_id,trace.taskId);
  return Response.json({id:'upstream-fixture',model:'glm-5.3-flash',choices:[{message:{content:'SECRET OUTPUT',reasoning_content:'SECRET REASONING'},finish_reason:'stop'}]},{headers:{'x-litellm-call-id':'proxy-fixture'}});
 },'http://127.0.0.1:4400/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer SECRET KEY'},body:JSON.stringify({model:'primary-standard',strictJsonSchema:true,messages:[{role:'user',content:'SECRET PROMPT'}]})}));
 assert.equal(calls,1);await store.record(trace,202);await store.record(trace,200);
 const rows=await store.list(trace.taskId);assert.equal(rows.length,1);assert.equal(rows[0]!.details.attempts[0].proxyCallId,'proxy-fixture');assert.equal(rows[0]!.details.attempts[0].finishReason,'stop');assert.equal(JSON.stringify(rows).includes('SECRET'),false);
 assert.equal((await store.list(trace.operationId)).length,1);await assert.rejects(store.list("' OR 1=1"));
 }finally{db.close();if(previous===undefined)delete process.env.AI_MODEL_ROUTING_MODE;else process.env.AI_MODEL_ROUTING_MODE=previous}
});
test('untrusted upstream headers and failure bodies are not copied to diagnostics',async()=>{
 const trace={requestId:randomUUID(),taskId:null,workspaceId:null,operationId:null,band:'standard',attempts:[] as Record<string,unknown>[]};
 await requestTraceContext.run(trace,()=>tracedModelFetch(async()=>Response.json({error:{message:'SECRET UPSTREAM ERROR'}},{status:502,headers:{'x-litellm-call-id':'invalid token with spaces'}}),'https://proxy.test/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'test-model'})}));
 assert.equal(trace.attempts[0]!.proxyCallId,null);assert.equal(trace.attempts[0]!.httpStatus,502);assert.ok(!JSON.stringify(trace).includes('SECRET'));
});
