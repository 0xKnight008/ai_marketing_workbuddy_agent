import {createServer} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {AiRuntimeClient} from './client';
test('task errors retain safe diagnostics and correlation without reflecting upstream secrets',async()=>{
 const requestId='11111111-1111-4111-8111-111111111111';
 const client=new AiRuntimeClient({baseUrl:'http://runtime.test',internalToken:'fixture',fetchImpl:async()=>Response.json({error:'task_output_invalid_json',requestId,message:'SECRET'},{status:502})});
 await assert.rejects(client.taskStep({}),new RegExp('task_output_invalid_json.*'+requestId));
 const malicious=new AiRuntimeClient({baseUrl:'http://runtime.test',internalToken:'fixture',fetchImpl:async()=>Response.json({error:'SECRET',requestId:'SECRET'},{status:502})});
 await assert.rejects(malicious.taskStep({}),error=>error instanceof Error&&error.message==='AI task step failed: 502');
});


test('native Runtime transport preserves auth and receives a delayed classification response',async()=>{
 const server=createServer(async(req,res)=>{
  assert.equal(req.url,'/internal/classify');
  assert.equal(req.headers['x-internal-token'],'local-fixture');
  for await(const _ of req) { /* drain local fixture body */ }
  await new Promise(resolve=>setTimeout(resolve,100));
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({assignments:[]}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  const client=new AiRuntimeClient({baseUrl:`http://127.0.0.1:${address.port}`,internalToken:'local-fixture'});
  assert.deepEqual(await client.classifyItems({items:[]}),{assignments:[]});
 }finally{
  server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 }
});
