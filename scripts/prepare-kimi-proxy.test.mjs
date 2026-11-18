import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {prepareKimiProxy,approvedKimiRates,writeKimiCandidate} from './prepare-kimi-proxy.mjs';
import {readFileSync,mkdtempSync,statSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(new URL('../platform/package.json',import.meta.url));
const yaml=require('js-yaml');
const oldConfig=readFileSync(new URL('../deploy/litellm/config-onetoken.yaml',import.meta.url),'utf8');
const now=Date.parse('2026-11-18T00:00:00Z');
const rates=Object.fromEntries(Object.entries({eco:'deepseek-flash',standard:'glm-5.3-flash',flagship:'kimi-k3.1-pro'}).map(([band,model])=>[band,{version:'fixture-v1',model,responseModels:[model],inputUsdPerMillion:'2',outputUsdPerMillion:'10',cacheUsdPerMillion:'0.2',...(band==='flagship'?{cacheWrite5mUsdPerMillion:'3',cacheWrite1hUsdPerMillion:'4'}:{}),source:'synthetic test prices, not a published tariff',verifiedAt:'2026-11-01T00:00:00Z',currency:'USD'}]));
const platform=`AI_METERING_MODE=cost-v1\nAI_METERING_RATES_JSON='${JSON.stringify(rates)}'\n`;
const runtime='AI_MODEL_ROUTING_MODE=three-channel\nDEEPSEEK_API_KEY=ds-fixture\nZAI_API_KEY=zai-fixture\nMOONSHOT_API_KEY=kimi-fixture\nOPENAI_API_KEY=virtual-fixture\nOPENAI_BASE_URL=http://127.0.0.1:4400/v1\n';
const proxy=`LITELLM_IMAGE=proxy@sha256:${'a'.repeat(64)}\nLITELLM_POSTGRES_IMAGE=pg@sha256:${'b'.repeat(64)}\nLITELLM_DB_PASSWORD=${'c'.repeat(64)}\nLITELLM_MASTER_KEY=sk-${'d'.repeat(64)}\nLITELLM_SALT_KEY=sk-${'e'.repeat(64)}\nFLAGSHIP_UPSTREAM_API_KEY=old-opus-key\n`;
const prepare=(p=platform,r=runtime,x=proxy,v=parseEnv(p).AI_METERING_RATES_JSON,config=oldConfig)=>prepareKimiProxy(p,r,x,v,now,config);
test('prepares official GLM/Kimi proxy candidates without changing mode, Eco, prices, or keys across providers',()=>{
 const result=prepare(),p=parseEnv(result.platform),r=parseEnv(result.runtime),x=parseEnv(result.proxy),next=JSON.parse(p.AI_METERING_RATES_JSON);
 assert.equal(p.AI_METERING_MODE,'cost-v1');assert.deepEqual(next.eco,rates.eco);
 assert.equal(r.AI_PROXY_BANDS,'standard,flagship');assert.equal(r.AI_PROXY_MODEL_PROFILE,'kimi');
 assert.equal(r.DEEPSEEK_API_KEY,'ds-fixture');assert.equal(r.ZAI_API_KEY,undefined);assert.equal(r.MOONSHOT_API_KEY,undefined);
 assert.equal(x.FLAGSHIP_UPSTREAM_API_KEY,'kimi-fixture');assert.equal(x.ZAI_API_KEY,'zai-fixture');assert.equal(x.FLAGSHIP_UPSTREAM_MODEL,'openai/kimi-k3.1-pro');
 assert.deepEqual(next.flagship.responseModels,['primary-flagship','kimi-k3.1-pro']);assert.equal(next.flagship.cacheWrite1hUsdPerMillion,'4');
 assert.match(result.config,/openai\/glm-5.3-flash/);assert.match(result.config,/cache_creation_input_token_cost_above_1hr/);assert.doesNotMatch(result.config,/__[A-Z]+_RATES__/);
 assert.deepEqual(prepareKimiProxy(result.platform,result.runtime,result.proxy,p.AI_METERING_RATES_JSON,now,result.config),result);
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

test('preserves a direct Eco calendar and requires the live entry when Eco is proxied',()=>{
 const next=structuredClone(rates);next.eco.validUntil='2027-01-01T00:00:00Z';next.eco.periods=[{id:'test',startsAt:'2026-12-01T00:00:00Z',endsAt:'2026-12-02T00:00:00Z',inputUsdPerMillion:'1',outputUsdPerMillion:'5',cacheUsdPerMillion:'0.1'}];
 const current=platform.replace(JSON.stringify(rates),JSON.stringify(next));
 const result=prepare(current);
 assert.deepEqual(JSON.parse(parseEnv(result.platform).AI_METERING_RATES_JSON).eco,next.eco);
 next.eco.model='primary-eco';
 assert.throws(()=>prepare(platform.replace(JSON.stringify(rates),JSON.stringify(next)),runtime.replace('three-channel','litellm'),proxy,undefined,''),/current LiteLLM YAML/);
});

function productionFixture(){
 const old=structuredClone(rates);
 old.eco={...old.eco,model:'primary-eco',responseModels:['deepseek-flash','primary-eco'],version:'ds-flash-20261026-cny67-r1-proxy-r1',currency:'CNY',fxSnapshot:'1 USD = 6.7 CNY',validUntil:'2026-12-31T16:00:00.000Z',inputUsdPerMillion:'0.149253731',cacheUsdPerMillion:'0.002985075',outputUsdPerMillion:'0.597014925'};
 // Synthetic UTC windows reproducing 98 periods, with 63 still unexpired.
 old.eco.periods=Array.from({length:98},(_,i)=>{
  const start=Date.parse('2026-10-31T12:00:00Z')+i*12*3600000;
  return {id:'peak-'+i,startsAt:new Date(start).toISOString(),endsAt:new Date(start+6*3600000).toISOString(),inputUsdPerMillion:'0.298507463',cacheUsdPerMillion:'0.005970149',outputUsdPerMillion:'1.194029851'};
 });
 old.standard={...old.standard,model:'primary-standard',responseModels:['primary-standard','gpt-6-sol'],version:'onetoken-standard-2026-10-29'};
 old.flagship={...old.flagship,model:'primary-flagship',responseModels:['primary-flagship','claude-opus-5-5'],version:'onetoken-flagship-2026-10-29'};
 return {old,p:platform.replace(JSON.stringify(rates),JSON.stringify(old)),r:runtime.replace('three-channel','litellm')+'AI_PROXY_MODEL_PROFILE=onetoken\nAI_PROXY_BANDS=eco,standard,flagship\n',x:proxy+'DEEPSEEK_API_KEY=active-eco-fixture\nLITELLM_ROUTING_PROFILE=onetoken\nSTANDARD_UPSTREAM_API_KEY=old-gpt-fixture\n'};
}
test('migrates legacy GPT/Opus prices using approved USD rates while preserving all 98 Eco periods and the live route',()=>{
 const {old,p,r,x}=productionFixture();
 const result=prepareKimiProxy(p,r,x,undefined,now,oldConfig);
 const next=JSON.parse(parseEnv(result.platform).AI_METERING_RATES_JSON);
 assert.deepEqual(next.eco,old.eco);
 assert.equal(next.eco.periods.filter(p=>Date.parse(p.endsAt)>now).length,63);
 assert.deepEqual(yaml.load(result.config).model_list[0],yaml.load(oldConfig).model_list[0]);
 assert.equal(yaml.load(result.config).model_list[0].model_info,undefined);
 assert.equal(parseEnv(result.runtime).AI_PROXY_BANDS,'eco,standard,flagship');
 assert.equal(parseEnv(result.proxy).DEEPSEEK_API_KEY,'active-eco-fixture');
 assert.equal(parseEnv(result.proxy).STANDARD_UPSTREAM_API_KEY,undefined);
 for(const [band,expected] of Object.entries(approvedKimiRates())){
  assert.deepEqual(next[band],{...expected,model:'primary-'+band,responseModels:['primary-'+band,expected.model],version:expected.version+'-kimi-proxy-r1'});
 }
 assert.deepEqual(yaml.load(result.config).model_list[1].model_info,{input_cost_per_token:0.00000015,output_cost_per_token:0.0000005,cache_read_input_token_cost:0.00000003});
 assert.deepEqual(yaml.load(result.config).model_list[2].model_info,{input_cost_per_token:0.000002,output_cost_per_token:0.00001,cache_read_input_token_cost:0.0000002,cache_creation_input_token_cost:0.000002,cache_creation_input_token_cost_above_1hr:0.000004});
 assert.equal(parseEnv(result.proxy).FLAGSHIP_UPSTREAM_BASE_URL,'https://api.moonshot.ai/v1');
 assert.deepEqual(prepareKimiProxy(result.platform,result.runtime,result.proxy,undefined,now,result.config),result);
});
test('preserves existing Eco model_info and per-model options instead of replacing them with off-peak rates',()=>{
 const {p,r,x}=productionFixture(),config=yaml.load(oldConfig);
 Object.assign(config.model_list[0],{model_info:{id:'existing-deepseek',input_cost_per_token:0.0000003}});
 config.model_list[0].litellm_params.timeout=450;
 const result=prepareKimiProxy(p,r,x,undefined,now,yaml.dump(config));
 assert.deepEqual(yaml.load(result.config).model_list[0],config.model_list[0]);
});
test('fails closed on missing, ambiguous, malformed or changed existing Eco routes',()=>{
 const {p,r,x}=productionFixture();
 for(const config of ['', 'model_list: []', 'model_list: [secret-fixture:', oldConfig.replace('model: deepseek/deepseek-flash','model: openai/other'),oldConfig.replace('os.environ/DEEPSEEK_API_KEY','plaintext-secret-fixture')]){
  assert.throws(()=>prepareKimiProxy(p,r,x,undefined,now,config),error=>!error.message.includes('secret-fixture'));
 }
 const custom=yaml.load(oldConfig);custom.litellm_settings.callbacks=['custom-pricing'];
 assert.throws(()=>prepareKimiProxy(p,r,x,undefined,now,yaml.dump(custom)),/Custom proxy/);
 const config=yaml.load(oldConfig);config.model_list.push(config.model_list[0]);
 assert.throws(()=>prepareKimiProxy(p,r,x,undefined,now,yaml.dump(config)),/exactly one/);
 assert.throws(()=>prepareKimiProxy(p,r,x.replace('DEEPSEEK_API_KEY=active-eco-fixture',''),undefined,now,oldConfig),/DEEPSEEK_API_KEY/);
});
test('rejects expired, overlapping, malformed or changed Eco calendars and new proxy calendars',()=>{
 const {p,r,x}=productionFixture();
 for(const edit of [e=>{e.validUntil='2026-11-01'},e=>{e.periods[1].startsAt=e.periods[0].startsAt},e=>{e.periods[0].endsAt='invalid'},e=>{e.periods[0].cacheUsdPerMillion='9'},e=>{delete e.validUntil},e=>{e.periods={}}]){
  const snapshot=JSON.parse(parseEnv(p).AI_METERING_RATES_JSON);edit(snapshot.eco);
  assert.throws(()=>prepareKimiProxy(p.replace(parseEnv(p).AI_METERING_RATES_JSON,JSON.stringify(snapshot)),r,x,undefined,now,oldConfig));
 }
 const snapshot={eco:productionFixture().old.eco,...approvedKimiRates()};
 snapshot.standard.validUntil='2027-01-01T00:00:00Z';snapshot.standard.periods=[snapshot.eco.periods[0]];
 assert.throws(()=>prepareKimiProxy(p,r,x,JSON.stringify(snapshot),now,oldConfig),/calendar.*glm-5.3-flash/);
});
test('uses explicit proxy official keys ahead of stale runtime copies',()=>{
 const {p,r,x}=productionFixture();
 const result=prepareKimiProxy(p,r,x+'ZAI_API_KEY=active-zai-fixture\nMOONSHOT_API_KEY=active-kimi-fixture\n',undefined,now,oldConfig);
 const env=parseEnv(result.proxy);
 assert.equal(env.ZAI_API_KEY,'active-zai-fixture');
 assert.equal(env.FLAGSHIP_UPSTREAM_API_KEY,'active-kimi-fixture');
});
test('requires official upstream keys and never reuses GPT or Opus credentials',()=>{
 const {p,r,x}=productionFixture();
 assert.throws(()=>prepareKimiProxy(p,r.replace('MOONSHOT_API_KEY=kimi-fixture','').replace('ZAI_API_KEY=zai-fixture',''),x,undefined,now,oldConfig),/MOONSHOT_API_KEY.*ZAI_API_KEY/);
});
test('writes protected candidates, refuses existing directories and removes incomplete new candidates',()=>{
 const parent=mkdtempSync(join(tmpdir(),'kimi-candidate-'));
 try{
  const out=join(parent,'candidate'),result=prepare();writeKimiCandidate(out,result);
  assert.equal(statSync(out).mode&0o777,0o700);
  for(const name of ['platform.env','runtime.env','proxy.env','config.yaml'])assert.equal(statSync(join(out,name)).mode&0o777,0o600);
  assert.throws(()=>writeKimiCandidate(out,result),{code:'EEXIST'});
  assert.equal(readFileSync(join(out,'platform.env'),'utf8'),result.platform);
  const incomplete=join(parent,'incomplete');
  assert.throws(()=>writeKimiCandidate(incomplete,{platform:'fixture',runtime:null}));
  assert.equal(existsSync(incomplete),false);
 }finally{rmSync(parent,{recursive:true,force:true})}
});
test('migrated snapshots retain actual off-peak/peak settlement, expiry and the approved GLM/Kimi cost formula',()=>{
 const {p,r,x}=productionFixture();
 const snapshot=JSON.parse(parseEnv(prepareKimiProxy(p,r,x,undefined,now,oldConfig).platform).AI_METERING_RATES_JSON);
 // Exercise the real TypeScript billing implementation, not a duplicated calculator.
 execFileSync(process.execPath,['--import',require.resolve('tsx'),'--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {readFileSync} from 'node:fs';
  import {validateRate,usageCostNanos,costCredits} from './shared/ai-metering.ts';
  const rates=JSON.parse(readFileSync(0,'utf8'));
  for(const r of Object.values(rates))validateRate(r);
  const u={input:1000000,output:0,cached:0};
  const peak=usageCostNanos(rates.eco,u,'2026-11-18T00:00:00Z');
  const off=usageCostNanos(rates.eco,u,'2026-11-18T06:00:00Z');
  assert.equal(peak,298507463n);assert.equal(off,149253731n);
  assert.equal(costCredits(peak),32);assert.equal(costCredits(off),16);
  assert.throws(()=>usageCostNanos(rates.eco,u,rates.eco.validUntil),/expired/);
  assert.equal(usageCostNanos(rates.standard,u),150000000n);
  assert.equal(costCredits(usageCostNanos(rates.standard,u)),16);
  assert.equal(costCredits(usageCostNanos(rates.flagship,u)),212);
  assert.equal(usageCostNanos(rates.flagship,{...u,cached:1000000}),200000000n);
  assert.equal(usageCostNanos(rates.flagship,{...u,cacheWrite5m:1000000}),2000000000n);
  assert.equal(usageCostNanos(rates.flagship,{...u,cacheWrite1h:1000000}),4000000000n);
 `],{cwd:fileURLToPath(new URL('..',import.meta.url)),input:JSON.stringify(snapshot),stdio:['pipe','pipe','pipe']});
});
