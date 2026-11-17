import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {prepareKimiProxy} from './prepare-kimi-proxy.mjs';
const rates=Object.fromEntries(Object.entries({eco:'deepseek-flash',standard:'glm-5.3-flash',flagship:'kimi-k3.1-pro'}).map(([band,model])=>[band,{version:'fixture-v1',model,responseModels:[model],inputUsdPerMillion:'2',outputUsdPerMillion:'10',cacheUsdPerMillion:'0.2',...(band==='flagship'?{cacheWrite5mUsdPerMillion:'3',cacheWrite1hUsdPerMillion:'4'}:{}),source:'synthetic test prices, not a published tariff',verifiedAt:'2026-11-01T00:00:00Z',currency:'USD'}]));
const platform=`AI_METERING_MODE=cost-v1\nAI_METERING_RATES_JSON='${JSON.stringify(rates)}'\n`;
const runtime='AI_MODEL_ROUTING_MODE=three-channel\nDEEPSEEK_API_KEY=ds-fixture\nZAI_API_KEY=zai-fixture\nMOONSHOT_API_KEY=kimi-fixture\nOPENAI_API_KEY=virtual-fixture\nOPENAI_BASE_URL=http://127.0.0.1:4400/v1\n';
const proxy=`LITELLM_IMAGE=proxy@sha256:${'a'.repeat(64)}\nLITELLM_POSTGRES_IMAGE=pg@sha256:${'b'.repeat(64)}\nLITELLM_DB_PASSWORD=${'c'.repeat(64)}\nLITELLM_MASTER_KEY=sk-${'d'.repeat(64)}\nLITELLM_SALT_KEY=sk-${'e'.repeat(64)}\nFLAGSHIP_UPSTREAM_API_KEY=old-opus-key\n`;
const prepare=(p=platform,r=runtime,x=proxy,v)=>prepareKimiProxy(p,r,x,v,Date.parse('2026-11-17T00:00:00Z'));
test('prepares official GLM/Kimi proxy candidates without changing mode, Eco, prices, or keys across providers',()=>{
 const result=prepare(),p=parseEnv(result.platform),r=parseEnv(result.runtime),x=parseEnv(result.proxy),next=JSON.parse(p.AI_METERING_RATES_JSON);
 assert.equal(p.AI_METERING_MODE,'cost-v1');assert.deepEqual(next.eco,rates.eco);
 assert.equal(r.AI_PROXY_BANDS,'standard,flagship');assert.equal(r.AI_PROXY_MODEL_PROFILE,'kimi');
 assert.equal(r.DEEPSEEK_API_KEY,'ds-fixture');assert.equal(r.ZAI_API_KEY,undefined);assert.equal(r.MOONSHOT_API_KEY,undefined);
 assert.equal(x.FLAGSHIP_UPSTREAM_API_KEY,'kimi-fixture');assert.equal(x.ZAI_API_KEY,'zai-fixture');assert.equal(x.FLAGSHIP_UPSTREAM_MODEL,'openai/kimi-k3.1-pro');
 assert.deepEqual(next.flagship.responseModels,['primary-flagship','kimi-k3.1-pro']);assert.equal(next.flagship.cacheWrite1hUsdPerMillion,'4');
 assert.match(result.config,/openai\/glm-5.3-flash/);assert.match(result.config,/cache_creation_input_token_cost_above_1hr/);assert.doesNotMatch(result.config,/__[A-Z]+_RATES__/);
 assert.deepEqual(prepareKimiProxy(result.platform,result.runtime,result.proxy,undefined,Date.parse('2026-11-17T00:00:00Z')),result);
});
test('preserves an existing proxied Eco and shadow rollout',()=>{
 const old=structuredClone(rates);old.eco.model='primary-eco';
 const current=platform.replace('cost-v1','shadow').replace(JSON.stringify(rates),JSON.stringify(old));
 const result=prepare(current,runtime.replace('three-channel','litellm'),proxy+'DEEPSEEK_API_KEY=active-proxy-eco-key\n');
 assert.equal(parseEnv(result.proxy).DEEPSEEK_API_KEY,'active-proxy-eco-key');
 assert.equal(parseEnv(result.runtime).AI_PROXY_BANDS,'eco,standard,flagship');
 assert.equal(parseEnv(result.platform).AI_METERING_MODE,'shadow');
});
test('refuses stale models, missing TTL prices, expired tariffs and accidental old supplier credentials',()=>{
 for(const edit of [r=>{r.eco.inputUsdPerMillion='99'},r=>{r.flagship.model='claude-opus-5-5'},r=>{delete r.flagship.cacheWrite1hUsdPerMillion},r=>{r.standard.responseModels=['gpt-6-sol']},r=>{r.flagship.validUntil='2026-11-01'},r=>{r.flagship.periods=[{}]},r=>{r.flagship.currency='CNY'}]){
  const next=structuredClone(rates);edit(next);assert.throws(()=>prepare(platform,runtime,proxy,JSON.stringify(next)));
 }
 assert.throws(()=>prepare(platform,runtime.replace('MOONSHOT_API_KEY=kimi-fixture',''),proxy),/credentials/);
 assert.throws(()=>prepare(platform,runtime.replace('127.0.0.1','remote.example'),proxy),/proxy root/);
 assert.throws(()=>prepare(platform.replace('cost-v1','legacy')),/metering/);
});

test('preserves a direct Eco calendar and refuses a calendar on a proxied band',()=>{
 const next=structuredClone(rates);next.eco.validUntil='2027-01-01T00:00:00Z';next.eco.periods=[{id:'test',startsAt:'2026-12-01T00:00:00Z',endsAt:'2026-12-02T00:00:00Z',inputUsdPerMillion:'1',outputUsdPerMillion:'5',cacheUsdPerMillion:'0.1'}];
 const current=platform.replace(JSON.stringify(rates),JSON.stringify(next));
 const result=prepare(current);
 assert.deepEqual(JSON.parse(parseEnv(result.platform).AI_METERING_RATES_JSON).eco,next.eco);
 next.eco.model='primary-eco';
 assert.throws(()=>prepare(platform.replace(JSON.stringify(rates),JSON.stringify(next)),runtime.replace('three-channel','litellm')),/calendar/);
});
