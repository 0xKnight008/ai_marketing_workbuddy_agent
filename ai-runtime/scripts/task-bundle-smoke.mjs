import assert from 'node:assert/strict';
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
const model=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 requests.push({path:req.url,body:JSON.parse(body)});
 const content=JSON.stringify({action:'answer',query:'',markdown:'## Welcome\n\nHere is the requested draft.',citations:[]});
 const base={id:'local-completion',created:1,model:'mock-eco'},usage={prompt_tokens:12,completion_tokens:4,total_tokens:16};
 if(requests.at(-1).body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})}\n\ndata: ${JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}],usage})}\n\ndata: [DONE]\n\n`)}
 else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({...base,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage}))}
});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const probe=netServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const runtimePort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const env={...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(runtimePort),INTERNAL_API_TOKEN:token,MASTRA_STORAGE_URL:`file:${join(scratch,'runtime.db')}`,MASTRA_STORAGE_AUTH_TOKEN:'',OPENAI_API_KEY:'local-test-only',OPENAI_BASE_URL:`http://127.0.0.1:${model.address().port}/v1`,AI_MODEL_ROUTING_MODE:'proxy'};
for(const band of ['ECO','STANDARD','FLAGSHIP']){env[`AI_MODEL_${band}`]=`openai/mock-${band.toLowerCase()}`;env[`AI_MODEL_${band}_FALLBACK`]=`openai/mock-${band.toLowerCase()}-fallback`;}
const child=spawn(process.execPath,['index.mjs'],{cwd:fileURLToPath(new URL('../.mastra/output/',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
let logs='';for(const output of [child.stdout,child.stderr])output.on('data',chunk=>{logs=(logs+chunk).slice(-16000)});
const base=`http://127.0.0.1:${runtimePort}`;
try{
 const deadline=Date.now()+45000;let ready=false;
 while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`Built runtime exited: ${logs}`);try{ready=(await fetch(`${base}/internal/health`,{signal:AbortSignal.timeout(1000)})).ok}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,150));}
 assert.ok(ready,`Built runtime did not become ready: ${logs}`);
 let response=await fetch(`${base}/internal/task-step`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,401);
 const headers={'content-type':'application/json','x-internal-token':token};response=await fetch(`${base}/internal/task-step`,{method:'POST',headers,body:'{}'});assert.equal(response.status,400);assert.equal(requests.length,0);
 response=await fetch(`${base}/internal/task-step`,{method:'POST',headers,body:JSON.stringify({taskId,goal:'Write a welcome draft',language:'en',modelBand:'eco',provider:'primary',history:[{role:'user',content:'Write a welcome draft'}],sources:[],steps:[],remainingSteps:4}),signal:AbortSignal.timeout(20000)});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.action,'answer');assert.match(result.markdown,/Welcome/);assert.equal(requests.length,1);assert.equal(requests[0].path,'/v1/chat/completions');
 response=await fetch(`${base}/internal/token-usage?q=${taskId}`,{headers});const rows=await response.json();assert.equal(response.status,200);assert.equal(rows.length,1);assert.equal(rows[0].run_id,taskId);assert.equal(rows[0].operation,'workspace-task');assert.equal(rows[0].total_tokens,16);
 console.log('Built task API: auth, schema validation, chat-completions execution and task-linked token ledger passed.');
}finally{
 child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await new Promise(resolve=>model.close(resolve));await rm(scratch,{recursive:true,force:true});
}
