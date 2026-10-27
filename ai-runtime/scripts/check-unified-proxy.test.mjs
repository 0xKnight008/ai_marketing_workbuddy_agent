import test from 'node:test';import assert from 'node:assert/strict';import {checkUnifiedProxy} from './check-unified-proxy.mjs';
const env={AI_MODEL_ROUTING_MODE:'litellm',OPENAI_BASE_URL:'http://127.0.0.1:4400/v1',OPENAI_API_KEY:'virtual-fixture'};
test('readiness and model access checks never generate a paid request',async()=>{
 const calls=[];const result=await checkUnifiedProxy(env,{fetcher:async(url,init)=>{calls.push(url);assert.equal(init.method,undefined);return Response.json(url.endsWith('/models')?{data:['eco','standard','flagship'].map(b=>({id:'primary-'+b}))}:{status:'healthy'})}});
 assert.equal(result.mode,'read-only');assert.equal(calls.length,2);assert.ok(calls[0].endsWith('/health/readiness'));
});
test('rejects a flagship-only virtual key before routing Standard through it',async()=>{
 await assert.rejects(checkUnifiedProxy(env,{fetcher:async()=>Response.json({data:[{id:'primary-flagship'}]})}),/primary-eco/);
});
