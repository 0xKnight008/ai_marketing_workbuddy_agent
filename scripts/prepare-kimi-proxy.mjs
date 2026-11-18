import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseEnv,isDeepStrictEqual} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateLiteLlmEnvironment} from './litellm-preflight.mjs';
const require=createRequire(new URL('../platform/package.json',import.meta.url));
const yaml=require('js-yaml');
class PreparationError extends Error {}
const fail=message=>{throw new PreparationError(message)};
function parseConfig(text){
 try{return yaml.load(text,{schema:yaml.JSON_SCHEMA})}catch{fail('Invalid proxy YAML; check the protected configuration locally')}
}
export function approvedKimiRates(){
 return JSON.parse(readFileSync(new URL('../deploy/litellm/rates-glm-kimi-2026-11-18.json',import.meta.url),'utf8'));
}
const models={eco:'deepseek-flash',standard:'glm-5.3-flash',flagship:'kimi-k3.1-pro'};
const serialize=env=>Object.entries(env).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>{
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||/[\r\n']/.test(value))fail('Unsupported env encoding');
 return key+"='"+value+"'";
}).join('\n')+'\n';
function verify(rate,model,now,routed){
 if(!rate || ![model,'primary-'+Object.keys(models).find(b=>models[b]===model)].includes(rate.model) || (!Array.isArray(rate.responseModels)||!rate.responseModels.includes(model)))fail('Snapshot must already authorize the official model: '+model);
 if(!/^[a-zA-Z0-9_.-]{1,65}$/.test(rate.version?.replace(/-kimi-proxy-r1$/,''))||!rate.source||!Number.isFinite(Date.parse(rate.verifiedAt))||Date.parse(rate.verifiedAt)>now)fail('Unverified rate snapshot');
 if(rate.currency && rate.currency!=='USD' && !rate.fxSnapshot)fail('Non-USD tariff needs an FX snapshot; numeric rates must be converted to USD');
 if(rate.validUntil!==undefined&&(!Number.isFinite(Date.parse(rate.validUntil))||Date.parse(rate.validUntil)<=now))fail('Expired rate snapshot');
 const price=(r,key,zero=false)=>{
  if(typeof r[key]!=='string'||!/^\d+(?:\.\d{1,9})?$/.test(r[key])||(!zero&&Number(r[key])<=0))fail('Invalid verified price: '+key);
 };
 if(rate.periods!==undefined){
  if(!Array.isArray(rate.periods)||rate.periods.length>1000||!rate.validUntil)fail('Invalid tariff calendar: '+model);
  const sorted=[...rate.periods].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  const ids=new Set();
  for(let i=0;i<sorted.length;i++){
   const p=sorted[i],start=Date.parse(p.startsAt),end=Date.parse(p.endsAt);
   if(!p.id||ids.has(p.id)||!Number.isFinite(start)||!Number.isFinite(end)||start>=end||(i>0&&Date.parse(sorted[i-1].endsAt)>start))fail('Invalid tariff calendar: '+model);
   ids.add(p.id);
  }
 }
 for(const r of [rate,...(rate.periods??[])]){
  for(const k of ['inputUsdPerMillion','outputUsdPerMillion'])price(r,k);
  price(r,'cacheUsdPerMillion',true);
  if(Number(r.cacheUsdPerMillion)>Number(r.inputUsdPerMillion))fail('Invalid cache price');
 }
 if(model==='kimi-k3.1-pro')for(const k of ['cacheWrite5mUsdPerMillion','cacheWrite1hUsdPerMillion'])price(rate,k);
 // A static proxy model_info cannot reproduce a time-varying calendar. Require
 // a separately reviewed cutover instead of silently logging the wrong costs.
 if(routed&&model!=='deepseek-flash'&&rate.periods?.length)fail('Time-varying tariffs require a matching proxy pricing calendar before migration: '+model);
}
export function prepareKimiProxy(platformText,runtimeText,proxyText,verifiedRates,now=Date.now(),currentProxyConfig){
 const p=parseEnv(platformText),r=parseEnv(runtimeText),x=parseEnv(proxyText);
 if(!['cost-v1','shadow'].includes(p.AI_METERING_MODE))fail('Verified cost metering must already be enabled');
 if(!['three-channel','litellm'].includes(r.AI_MODEL_ROUTING_MODE))fail('Expected three-channel or LiteLLM source routing');
 const existing=JSON.parse(p.AI_METERING_RATES_JSON??'');
 // The approved international USD snapshot replaces old GPT/Opus identities.
 // Eco is copied verbatim, including FX provenance, expiry and all UTC periods.
 const rates=verifiedRates?JSON.parse(verifiedRates):{eco:existing.eco,...approvedKimiRates()};
 if(!isDeepStrictEqual(rates.eco,existing.eco))fail('This migration must preserve the existing Eco rate snapshot');
 const ecoProxy=r.AI_MODEL_ROUTING_MODE==='litellm'&&(r.AI_PROXY_BANDS??'eco,standard,flagship').split(',').map(s=>s.trim()).includes('eco');
 if(!r.OPENAI_API_KEY||r.OPENAI_API_KEY===x.LITELLM_MASTER_KEY)fail('Configure a dedicated runtime virtual key');
 const root=new URL(r.OPENAI_BASE_URL??'');
 if(root.username||root.password||root.search||root.hash||!root.pathname.replace(/\/$/,'').endsWith('/v1')||!['https:','http:'].includes(root.protocol)||(root.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(root.hostname)))fail('Invalid proxy root');
 const config=parseConfig(readFileSync(new URL('../deploy/litellm/config-kimi.yaml',import.meta.url),'utf8'));
 if(ecoProxy){
  if(!currentProxyConfig)fail('Existing proxied Eco requires the current LiteLLM YAML configuration');
  const old=parseConfig(currentProxyConfig);
  if(!Array.isArray(old?.model_list))fail('Missing existing proxy model_list');
  for(const key of ['router_settings','litellm_settings','general_settings']){
   if(!isDeepStrictEqual(old[key],config[key]))fail('Custom proxy '+key+' requires review before migration');
  }
  const entries=old.model_list.filter(m=>m?.model_name==='primary-eco');
  if(!entries||entries.length!==1)fail('Expected exactly one existing primary-eco model');
  const params=entries[0].litellm_params;
  if(params?.model!=='deepseek/deepseek-flash'||params.api_base!=='https://api.deepseek.com/v1'||params.api_key!=='os.environ/DEEPSEEK_API_KEY')fail('Existing Eco route needs review; expected the official DeepSeek route and env key reference');
  // Preserve the complete per-model entry, including optional model_info.
  // Do not manufacture a static model_info from Eco's base/peak rates.
  config.model_list[0]=entries[0];
 }
 for(const [band,model] of Object.entries(models)){
  const rate=rates[band];
  verify(rate,model,now,band!=='eco'||ecoProxy);
  // Preserve Eco route and its billing identity/version exactly.
  if(band==='eco'&&rate.model!==(ecoProxy?'primary-eco':model))fail('Eco snapshot does not match existing route');
  if(band!=='eco'){
   rate.model='primary-'+band;rate.responseModels=[rate.model,model];
   rate.version=rate.version.replace(/-kimi-proxy-r1$/,'')+'-kimi-proxy-r1';
  }
  if(band==='eco'&&ecoProxy)continue;
  const info={input_cost_per_token:Number(rate.inputUsdPerMillion+'e-6'),output_cost_per_token:Number(rate.outputUsdPerMillion+'e-6'),cache_read_input_token_cost:Number(rate.cacheUsdPerMillion+'e-6')};
  if(band==='flagship')Object.assign(info,{cache_creation_input_token_cost:Number(rate.cacheWrite5mUsdPerMillion+'e-6'),cache_creation_input_token_cost_above_1hr:Number(rate.cacheWrite1hUsdPerMillion+'e-6')});
  config.model_list.find(m=>m.model_name==='primary-'+band).model_info=info;
 }
 const moonshot=x.MOONSHOT_API_KEY||(x.LITELLM_ROUTING_PROFILE==='kimi'?x.FLAGSHIP_UPSTREAM_API_KEY:undefined)||r.MOONSHOT_API_KEY;
 const ds=ecoProxy?x.DEEPSEEK_API_KEY:(r.DEEPSEEK_API_KEY||x.DEEPSEEK_API_KEY);
 const zai=x.ZAI_API_KEY||r.ZAI_API_KEY;
 const missing=[!moonshot&&'MOONSHOT_API_KEY (international)',!ds&&'DEEPSEEK_API_KEY',!zai&&'ZAI_API_KEY'].filter(Boolean);
 if(missing.length)fail('Missing official provider credentials: '+missing.join(', '));
 Object.assign(x,{DEEPSEEK_API_KEY:ds,ZAI_API_KEY:zai,FLAGSHIP_UPSTREAM_MODEL:'openai/kimi-k3.1-pro',FLAGSHIP_UPSTREAM_BASE_URL:'https://api.moonshot.ai/v1',FLAGSHIP_UPSTREAM_API_KEY:moonshot,LITELLM_ROUTING_PROFILE:'kimi',LITELLM_CONFIG_FILE:'/etc/piggybot/litellm-config.yaml'});
 for(const key of ['STANDARD_UPSTREAM_MODEL','STANDARD_UPSTREAM_BASE_URL','STANDARD_UPSTREAM_API_KEY','OPUS_UPSTREAM_API_KEY','MOONSHOT_API_KEY'])delete x[key];
 Object.assign(r,{AI_MODEL_ROUTING_MODE:'litellm',AI_PROXY_MODEL_PROFILE:'kimi',AI_PROXY_BANDS:ecoProxy?'eco,standard,flagship':'standard,flagship'});
 if(!ecoProxy)r.DEEPSEEK_API_KEY=ds;
 delete r.MOONSHOT_API_KEY;delete r.ZAI_API_KEY;
 p.AI_METERING_RATES_JSON=JSON.stringify(rates);
 try{validateLiteLlmEnvironment(x)}catch(error){fail(error.message)}
 return {platform:serialize(p),runtime:serialize(r),proxy:serialize(x),config:yaml.dump(config,{noRefs:true,lineWidth:-1})};
}
export function writeKimiCandidate(out,result){
 // Validate everything before creating the destination. Never overwrite a candidate.
 mkdirSync(out,{mode:0o700});
 try{
  for(const [name,text] of Object.entries(result))writeFileSync(join(out,name==='config'?'config.yaml':name+'.env'),text,{mode:0o600,flag:'wx'});
 }catch(error){rmSync(out,{recursive:true,force:true});throw error}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let stage='reading protected environment files';
 try{
  const [out,rateFile]=process.argv.slice(2);if(!out)fail('Missing new candidate directory');
  const p=readFileSync('/etc/piggybot/platform.env','utf8'),r=readFileSync('/etc/piggybot/ai-runtime.env','utf8'),x=readFileSync('/etc/piggybot/litellm.env','utf8');
  const runtime=parseEnv(r),proxy=parseEnv(x);
  const ecoProxy=runtime.AI_MODEL_ROUTING_MODE==='litellm'&&(runtime.AI_PROXY_BANDS??'eco,standard,flagship').split(',').map(s=>s.trim()).includes('eco');
  stage='reading the current Eco proxy configuration';
  const currentConfig=ecoProxy?readFileSync(resolve(fileURLToPath(new URL('../deploy/litellm/',import.meta.url)),proxy.LITELLM_CONFIG_FILE||'config.yaml'),'utf8'):undefined;
  stage='reading the optional verified rate snapshot';
  const verified=rateFile?readFileSync(rateFile,'utf8'):undefined;
  stage='validating configuration and rates';
  const result=prepareKimiProxy(p,r,x,verified,Date.now(),currentConfig);
  stage='writing a new protected candidate directory';
  writeKimiCandidate(out,result);
  console.log('Protected GLM/Kimi proxy candidates prepared. Live files unchanged.');
  console.log('Standard/Flagship use verified USD rates. Eco route, proxy entry and full platform tariff calendar are preserved.');
  console.log('Eco LiteLLM spend remains its existing estimate; use platform time-based receipts and supplier invoices for reconciliation.');
 }catch(error){
  // YAML/JSON parser exceptions can contain source excerpts: never print them.
  console.error(error instanceof PreparationError?'Preparation blocked: '+error.message:'Preparation failed while '+stage+' ('+(error.code??'invalid input')+').');
  console.error('Live files unchanged. Do not run candidate preflight until preparation succeeds.');
  process.exitCode=1;
 }
}
