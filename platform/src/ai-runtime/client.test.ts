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
