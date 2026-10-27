import test from 'node:test';import assert from 'node:assert/strict';import {parseEnv} from 'node:util';import {prepareRouting} from './prepare-unified-proxy.mjs';
const rates=Object.fromEntries(Object.entries({eco:'deepseek-flash',standard:'glm-5.3-flash',flagship:'gpt-6-sol'}).map(([band,model])=>[band,{version:'fixture-v1',model,responseModels:[model],inputUsdPerMillion:'2',outputUsdPerMillion:'10',cacheUsdPerMillion:'0.2',periods:[{id:'preserve-calendar'}],fxSnapshot:'preserve-fx'}]));
const platform="AI_METERING_MODE=shadow\nAI_METERING_RATES_JSON='"+JSON.stringify(rates)+"'\nUNCHANGED=fixture";
const runtime='OPENAI_API_KEY=virtual-fixture\nOPENAI_BASE_URL=http://127.0.0.1:4400/v1\nDEEPSEEK_API_KEY=ds-fixture\nZAI_API_KEY=zai-fixture';
test('staged and full candidates preserve rate amounts/calendar and only update identities',()=>{
 for(const bands of ['standard,flagship','eco,standard,flagship']){
  const result=prepareRouting(platform,runtime,'LITELLM_SALT_KEY=stable-fixture',bands);
  const p=parseEnv(result.platform),r=parseEnv(result.runtime),proxy=parseEnv(result.proxy),prices=JSON.parse(p.AI_METERING_RATES_JSON);
  assert.equal(p.AI_METERING_MODE,'shadow');assert.equal(r.AI_PROXY_BANDS,bands);assert.equal(proxy.LITELLM_SALT_KEY,'stable-fixture');assert.equal(proxy.ZAI_API_KEY,'zai-fixture');assert.match(result.config,/input_cost_per_token: 0.000002/);
  for(const band of ['eco','standard','flagship']){assert.deepEqual(prices[band].periods,rates[band].periods);assert.equal(prices[band].inputUsdPerMillion,rates[band].inputUsdPerMillion);assert.equal(prices[band].model,bands.includes(band)?'primary-'+band:rates[band].model)}
 }
});
test('rejects non-shadow candidates and incomplete model identity without echoing values',()=>{
 assert.throws(()=>prepareRouting(platform.replace('=shadow','=cost-v1'),runtime,'','standard,flagship'),/shadow/);
 assert.throws(()=>prepareRouting(platform,runtime,'','standard'),/bands/);
 assert.throws(()=>prepareRouting(platform,runtime.replace('ZAI_API_KEY=zai-fixture',''),'','standard,flagship'),/credentials/);
});
