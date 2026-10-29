import test from 'node:test';import assert from 'node:assert/strict';import {parseEnv} from 'node:util';
import {prepareOneToken} from './prepare-onetoken-proxy.mjs';
import {prepareRouting} from './prepare-unified-proxy.mjs';
const eco={model:'primary-eco',responseModels:['primary-eco','deepseek-flash'],periods:[{id:'preserve'}],fxSnapshot:'6.7'};
const platform="AI_METERING_MODE=shadow\nAI_METERING_RATES_JSON='"+JSON.stringify({eco})+"'\nOTHER=preserved";
const runtime='AI_MODEL_ROUTING_MODE=litellm\nAI_PROXY_BANDS=eco,standard,flagship\nZAI_API_KEY=remove-me\nOPENAI_API_KEY=keep-virtual';
const env={LITELLM_IMAGE:'litellm@sha256:'+'a'.repeat(64),LITELLM_POSTGRES_IMAGE:'postgres@sha256:'+'b'.repeat(64),LITELLM_DB_PASSWORD:'c'.repeat(64),LITELLM_MASTER_KEY:'sk-'+'d'.repeat(64),LITELLM_SALT_KEY:'sk-'+'e'.repeat(64),FLAGSHIP_UPSTREAM_MODEL:'openai/gpt-6-sol',FLAGSHIP_UPSTREAM_BASE_URL:'https://api.1token.ai/v1',FLAGSHIP_UPSTREAM_API_KEY:'gpt-fixture',OPUS_UPSTREAM_API_KEY:'opus-fixture',DEEPSEEK_API_KEY:'keep-ds',ZAI_API_KEY:'remove-zai'};
const text=e=>Object.entries(e).map(([k,v])=>k+'='+v).join('\n');
test('separates GPT/Opus keys, removes ZAI, replaces stale model identities and preserves Eco exactly',()=>{
 const result=prepareOneToken(platform,runtime,text(env),'2026-10-29T00:00:00Z');
 const p=parseEnv(result.platform),r=parseEnv(result.runtime),x=parseEnv(result.proxy),rates=JSON.parse(p.AI_METERING_RATES_JSON);
 assert.deepEqual(rates.eco,eco);assert.equal(p.AI_METERING_MODE,'shadow');assert.equal(p.OTHER,'preserved');
 assert.equal(x.STANDARD_UPSTREAM_API_KEY,'gpt-fixture');assert.equal(x.FLAGSHIP_UPSTREAM_API_KEY,'opus-fixture');assert.equal(x.OPUS_UPSTREAM_API_KEY,undefined);
 assert.equal(x.ZAI_API_KEY,undefined);assert.equal(r.ZAI_API_KEY,undefined);assert.equal(r.OPENAI_API_KEY,'keep-virtual');assert.equal(x.DEEPSEEK_API_KEY,'keep-ds');
 assert.deepEqual(rates.standard.responseModels,['primary-standard','gpt-6-sol']);assert.deepEqual(rates.flagship.responseModels,['primary-flagship','claude-opus-5-5']);
 assert.equal(rates.standard.inputUsdPerMillion,'2');assert.equal(rates.flagship.cacheWrite1hUsdPerMillion,'8');
 assert.doesNotMatch(result.config,/ZAI|z\.ai|glm-/);assert.match(result.config,/STANDARD_UPSTREAM_API_KEY/);
 const repeated=prepareOneToken(result.platform,result.runtime,result.proxy,'2026-10-29T00:00:00Z');assert.deepEqual(repeated,result);
 assert.throws(()=>prepareRouting(result.platform,result.runtime,result.proxy,'eco,standard,flagship'),/prepare-onetoken/);
});
test('fails before mutation for missing Opus key, wrong root, non-shadow mode or partial routing',()=>{
 for(const bad of [{...env,OPUS_UPSTREAM_API_KEY:''},{...env,FLAGSHIP_UPSTREAM_BASE_URL:'https://wrong.example/v1'},{...env,FLAGSHIP_UPSTREAM_MODEL:'openai/wrong'}])assert.throws(()=>prepareOneToken(platform,runtime,text(bad)));
 assert.throws(()=>prepareOneToken(platform.replace('=shadow','=cost-v1'),runtime,text(env)),/shadow/);
 assert.throws(()=>prepareOneToken(platform,runtime.replace('eco,standard,flagship','standard,flagship'),text(env)),/three proxy/);
});
