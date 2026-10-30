import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Exercise the built server and real Mastra serialization against a local model stub.
// No paid provider, external messages, production data or credentials are used.
const scratch=await mkdtemp(join(tmpdir(),'piggy-task-bundle-'));
const taskId='11111111-1111-4111-8111-111111111111',token='local-bundle-test-token';
const requests=[];
let replyMode='normal';
const model=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 requests.push({path:req.url,body:JSON.parse(body)});
 const current=requests.at(-1).body;
 if(replyMode==='slow')await new Promise(resolve=>setTimeout(resolve,600));
 if(replyMode==='http-timeout')await new Promise(resolve=>setTimeout(resolve,1600));
 const text=current.messages.map(message=>typeof message.content==='string'?message.content:(message.content??[]).map(part=>part.text??'').join('')).findLast(value=>value.includes('Items as JSON:\n'));
 const result=text?{assignments:JSON.parse(text.slice(text.indexOf('Items as JSON:\n')+'Items as JSON:\n'.length)).map(item=>({itemIndex:item.index,tags:[],sentiment:{label:'neutral',confidence:1,evidence:item.text}}))}:{action:'answer',query:'',markdown:'## Welcome\n\nHere is the requested draft.',citations:[]};
 if(replyMode==='rich')result.markdown='## Evidence\n\n| Item | Value |\n|---|---|\n| Quote | \"quoted\" |\n\n```text\nC:\\fixture\\data\n```';
 if(replyMode==='invalid-schema')result.action='unsupported';
 if(replyMode==='missing-content')result.markdown='';
 const content=replyMode==='invalid'?'Here is the report, without JSON.':replyMode==='empty'?'':replyMode==='fenced'?'```json\n'+JSON.stringify(result)+'\n```':JSON.stringify(result);
 if(current.model!=='primary-flagship'||process.env.AI_PROXY_MODEL_PROFILE==='onetoken')assert.equal(current.response_format?.type,'json_object');
 if(current.model!=='primary-flagship'||process.env.AI_PROXY_MODEL_PROFILE==='onetoken')assert.equal(current.strictJsonSchema,undefined);
 else assert.equal(current.response_format?.type,'json_schema');
 const base={id:'local-completion',created:1,model:current.model},usage={prompt_tokens:12,completion_tokens:4,total_tokens:16};
 if(requests.at(-1).body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})}\n\ndata: ${JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:replyMode==='truncated'?'length':'stop'}],usage})}\n\ndata: [DONE]\n\n`)}
 else{res.writeHead(200,{'content-type':'application/json','x-litellm-call-id':'bundle-call-'+requests.length});res.end(JSON.stringify({...base,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:replyMode==='truncated'?'length':'stop'}],usage}))}
});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const probe=netServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const runtimePort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const env={...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(runtimePort),INTERNAL_API_TOKEN:token,MASTRA_STORAGE_URL:`file:${join(scratch,'runtime.db')}`,MASTRA_STORAGE_AUTH_TOKEN:'',OPENAI_API_KEY:'local-test-only',OPENAI_BASE_URL:`http://127.0.0.1:${model.address().port}/v1`,AI_MODEL_ROUTING_MODE:'litellm',AI_PROXY_BANDS:'eco,standard,flagship',AI_MODEL_HTTP_TIMEOUT_MS:'1200',AI_RUNTIME_REQUEST_TIMEOUT_MS:'3000'};
for(const band of ['ECO','STANDARD','FLAGSHIP']){env[`AI_MODEL_${band}`]=`openai/mock-${band.toLowerCase()}`;env[`AI_MODEL_${band}_FALLBACK`]=`openai/mock-${band.toLowerCase()}-fallback`;}
const child=spawn(process.execPath,['index.mjs'],{cwd:fileURLToPath(new URL('../.mastra/output/',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
let logs='';for(const output of [child.stdout,child.stderr])output.on('data',chunk=>{logs=(logs+chunk).slice(-16000)});
const base=`http://127.0.0.1:${runtimePort}`;
try{
 const deadline=Date.now()+45000;let ready=false;
 while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`Built runtime exited: ${logs}`);try{ready=(await fetch(`${base}/internal/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,150));}
 assert.ok(ready,`Built runtime did not become ready: ${logs}`);
 const health=await (await fetch(`${base}/internal/health`)).json();assert.equal(health.requestTimeoutMs,3000);assert.equal(health.modelHttpTimeoutMs,1200);
 let response=await fetch(`${base}/internal/task-step`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,401);
 const headers={'content-type':'application/json','x-internal-token':token};response=await fetch(`${base}/internal/task-step`,{method:'POST',headers,body:'{}'});assert.equal(response.status,400);assert.equal(requests.length,0);
 response=await fetch(`${base}/internal/task-step`,{method:'POST',headers,body:JSON.stringify({taskId,goal:'Write a welcome draft',language:'en',modelBand:'eco',provider:'primary',history:[{role:'user',content:'Write a welcome draft'}],sources:[],steps:[],remainingSteps:4}),signal:AbortSignal.timeout(20000)});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.action,'answer');assert.match(result.markdown,/Welcome/);assert.equal(requests.length,1);assert.equal(requests[0].path,'/v1/chat/completions');
 response=await fetch(`${base}/internal/token-usage?q=${taskId}`,{headers});const rows=await response.json();assert.equal(response.status,200);assert.equal(rows.length,1);assert.equal(rows[0].run_id,taskId);assert.equal(rows[0].operation,'workspace-task');assert.equal(rows[0].total_tokens,16);
 const metered={taskId,goal:'Write a welcome draft',language:'en',modelBand:'eco',provider:'primary',history:[{role:'user',content:'Write a welcome draft'}],sources:[],steps:[],remainingSteps:4,
 _metering:{workspaceId:'22222222-2222-4222-8222-222222222222',operationId:'33333333-3333-4333-8333-333333333333',requestId:'44444444-4444-4444-8444-444444444444',band:'eco',maxCostNanos:'10000000',maxInputTokens:8000,maxOutputTokens:1500,rate:{version:'fixture-v1',model:'primary-eco',responseModels:['primary-eco'],inputUsdPerMillion:'2',outputUsdPerMillion:'10',cacheUsdPerMillion:'0.2',source:'local fixture only',verifiedAt:'2026-10-24T00:00:00Z'}}};
 const execute=()=>fetch(`${base}/internal/task-step`,{method:'POST',headers,body:JSON.stringify(metered),signal:AbortSignal.timeout(20000)});
 response=await execute();const paid=await response.json();assert.equal(response.status,200,JSON.stringify(paid));assert.equal(paid.action,'answer');assert.equal(paid._metering.length,1);assert.equal(paid._metering[0].status,'known');assert.equal(paid._metering[0].costNanos,'64000');
 assert.equal(requests.length,2);assert.ok(requests[1].body.max_tokens<=1500);
 response=await execute();const replay=await response.json();assert.equal(response.status,200);assert.equal(replay.markdown,paid.markdown);assert.deepEqual(replay._metering,paid._metering);assert.equal(requests.length,2);
 for(const band of ['eco','standard','flagship'])for(const shadow of [true,false]){
  const operationId=randomUUID();
  // Same 48-item shape as the reported source: two chunks (25 + 23).
  const source=Array.from({length:48},(_,index)=>({text:'Source comment '+index}));
  for(let offset=0;offset<source.length;offset+=25){
   const payload={modelBand:band,provider:'primary',items:source.slice(offset,offset+25).map((item,index)=>({...item,index})),_metering:{...metered._metering,operationId,requestId:randomUUID(),band,shadow,maxCostNanos:'100000000',maxInputTokens:16000,rate:{...metered._metering.rate,model:'primary-'+band,responseModels:['primary-'+band]}}};
   const before=requests.length;
   const classify=()=>fetch(`${base}/internal/classify`,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
   const response=await classify(),body=await response.json();
   assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.assignments.length,payload.items.length);assert.equal(body._metering.length,1);assert.equal(body._metering[0].status,'known');assert.equal(body._metering[0].costNanos,'64000');
   assert.equal(requests.length,before+1);assert.equal(requests.at(-1).body.model,'primary-'+band);assert.ok(!JSON.stringify(requests.at(-1).body).includes('_metering'));
   const cached=await classify();assert.equal(cached.status,200);assert.deepEqual(await cached.json(),body);assert.equal(requests.length,before+1);
  }
 }
 // Regression: every JSON-mode band shares parsing and durable single-call replay.
 for(const band of ['eco','standard','flagship']){
  replyMode='normal';
  const payload={...metered,modelBand:band,_metering:{...metered._metering,requestId:randomUUID(),operationId:randomUUID(),band,shadow:true,rate:{...metered._metering.rate,model:'primary-'+band,responseModels:['primary-'+band]}}};
  const r=await fetch(`${base}/internal/task-step`,{method:'POST',headers,body:JSON.stringify(payload)});
  const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.action,'answer');assert.equal(body._metering.length,1);
 }
 for(const band of process.env.AI_PROXY_MODEL_PROFILE==='onetoken'?['eco','standard','flagship']:['eco','standard'])
 for(const [mode,code] of [['rich',null],['fenced',null],['invalid','task_output_invalid_json'],['empty','task_output_empty'],['truncated','task_output_truncated'],['invalid-schema','task_output_invalid_schema'],['missing-content','task_output_missing_content']]){
  replyMode=mode;
  const requestId=randomUUID(),payload={...metered,modelBand:band,_metering:{...metered._metering,requestId,operationId:randomUUID(),band,rate:{...metered._metering.rate,model:'primary-'+band,responseModels:['primary-'+band]}}};
  const count=requests.length;
  const send=()=>fetch(`${base}/internal/task-step`,{method:'POST',headers,body:JSON.stringify(payload)});
  const r=await send(),body=await r.json();assert.equal(r.status,code?502:200,JSON.stringify(body));if(code)assert.equal(body.error,code);if(mode==='rich'){assert.match(body.markdown,/## Evidence/);assert.ok(body.markdown.includes('C:\\fixture\\data'));assert.ok(body.markdown.includes('```text'));}assert.equal(body._metering.length,1);assert.equal(requests.length,count+1);
  const cached=await send();assert.equal(cached.status,r.status);assert.deepEqual(await cached.json(),body);assert.equal(requests.length,count+1,'replay must not call or charge upstream again');
  const diagnostics=await (await fetch(`${base}/internal/request-traces?id=${requestId}`,{headers})).json();
  const original=diagnostics.find(row=>row.details.attempts.length===1);assert.ok(original);assert.equal(original.details.attempts[0].proxyCallId,'bundle-call-'+(count+1));assert.equal(original.details.failureCode,code);assert.ok(!JSON.stringify(diagnostics).includes('Here is the report'));
  assert.equal(requests.at(-1).body.metadata.piggybot_task_id,taskId);
 }
 assert.equal((await fetch(`${base}/internal/request-traces?id=${taskId}`)).status,401);
 // Delayed classification must preserve valid output/receipts and never call again on replay.
 replyMode='slow';
 const slowId=randomUUID(),slowPayload={modelBand:'standard',provider:'primary',items:[{index:0,text:'Local delayed fixture'}],_metering:{...metered._metering,requestId:slowId,operationId:randomUUID(),band:'standard',rate:{...metered._metering.rate,model:'primary-standard',responseModels:['primary-standard']}}};
 const beforeSlow=requests.length;
 const slow=()=>fetch(`${base}/internal/classify`,{method:'POST',headers,body:JSON.stringify(slowPayload)});
 const slowResult=await slow(),slowBody=await slowResult.json();assert.equal(slowResult.status,200,JSON.stringify(slowBody));assert.equal(slowBody.assignments.length,1);assert.equal(slowBody._metering[0].status,'known');
 const slowReplay=await slow();assert.deepEqual(await slowReplay.json(),slowBody);assert.equal(requests.length,beforeSlow+1);
 replyMode='http-timeout';
 const timeoutPayload={...slowPayload,_metering:{...slowPayload._metering,requestId:randomUUID(),operationId:randomUUID()}};
 const beforeTimeout=requests.length;
 const timed=()=>fetch(`${base}/internal/classify`,{method:'POST',headers,body:JSON.stringify(timeoutPayload)});
 const timedResult=await timed(),timedBody=await timedResult.json();assert.equal(timedResult.status,502);assert.equal(timedBody._metering[0].status,'unknown');
 const timedReplay=await timed();assert.equal(timedReplay.status,502);assert.deepEqual(await timedReplay.json(),timedBody);assert.equal(requests.length,beforeTimeout+1);
 console.log('Compiled deadlines: delayed classification succeeds, genuine transport timeout stays bounded, receipts and replay remain durable.');
 console.log('Built unified proxy tasks: JSON modes, all bands, output failures, call correlation, sanitized traces and single-charge replay passed.');
 console.log('Built classification API: all three bands in shadow/cost-v1, 48 items in two chunks, strict input, provider calls, receipts and replay passed.');
 console.log('Built task API: auth, schema validation, execution, token ledger, cost receipts, output budget and durable replay passed.');
}finally{
 child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await new Promise(resolve=>model.close(resolve));await rm(scratch,{recursive:true,force:true});
}
