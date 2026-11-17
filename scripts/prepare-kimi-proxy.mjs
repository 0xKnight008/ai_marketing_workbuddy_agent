import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv,isDeepStrictEqual} from 'node:util';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateLiteLlmEnvironment} from './litellm-preflight.mjs';
const models={eco:'deepseek-flash',standard:'glm-5.3-flash',flagship:'kimi-k3.1-pro'};
const serialize=env=>Object.entries(env).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>{
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||/[\r\n']/.test(value))throw new Error('Unsupported env encoding');
 return key+"='"+value+"'";
}).join('\n')+'\n';
function verify(rate,model,now,routed){
 if(!rate || ![model,'primary-'+Object.keys(models).find(b=>models[b]===model)].includes(rate.model) || (!Array.isArray(rate.responseModels)||!rate.responseModels.includes(model)))throw new Error('Snapshot must already authorize the official model: '+model);
 if(!/^[a-zA-Z0-9_.-]{1,65}$/.test(rate.version?.replace(/-kimi-proxy-r1$/,''))||!rate.source||!Number.isFinite(Date.parse(rate.verifiedAt))||Date.parse(rate.verifiedAt)>now)throw new Error('Unverified rate snapshot');
 if(rate.currency && rate.currency!=='USD' && !rate.fxSnapshot)throw new Error('Non-USD tariff needs an FX snapshot; numeric rates must be converted to USD');
 if(rate.validUntil!==undefined&&(!Number.isFinite(Date.parse(rate.validUntil))||Date.parse(rate.validUntil)<=now))throw new Error('Expired rate snapshot');
 const price=(r,key,zero=false)=>{
  if(typeof r[key]!=='string'||!/^\d+(?:\.\d{1,9})?$/.test(r[key])||(!zero&&Number(r[key])<=0))throw new Error('Invalid verified price: '+key);
 };
 for(const r of [rate,...(rate.periods??[])]){
  for(const k of ['inputUsdPerMillion','outputUsdPerMillion'])price(r,k);
  price(r,'cacheUsdPerMillion',true);
  if(Number(r.cacheUsdPerMillion)>Number(r.inputUsdPerMillion))throw new Error('Invalid cache price');
 }
 if(model==='kimi-k3.1-pro')for(const k of ['cacheWrite5mUsdPerMillion','cacheWrite1hUsdPerMillion'])price(rate,k);
 // A static proxy model_info cannot reproduce a time-varying calendar. Require
 // a separately reviewed cutover instead of silently logging the wrong costs.
 if(routed&&rate.periods?.length)throw new Error('Time-varying tariffs require a matching proxy pricing calendar before migration');
}
export function prepareKimiProxy(platformText,runtimeText,proxyText,verifiedRates,now=Date.now()){
 const p=parseEnv(platformText),r=parseEnv(runtimeText),x=parseEnv(proxyText);
 if(!['cost-v1','shadow'].includes(p.AI_METERING_MODE))throw new Error('Verified cost metering must already be enabled');
 if(!['three-channel','litellm'].includes(r.AI_MODEL_ROUTING_MODE))throw new Error('Expected three-channel or LiteLLM source routing');
 const existing=JSON.parse(p.AI_METERING_RATES_JSON??'');
 const rates=JSON.parse(verifiedRates??p.AI_METERING_RATES_JSON??'');
 if(!isDeepStrictEqual(rates.eco,existing.eco))throw new Error('This migration must preserve the existing Eco rate snapshot');
 const ecoProxy=r.AI_MODEL_ROUTING_MODE==='litellm'&&(r.AI_PROXY_BANDS??'eco,standard,flagship').split(',').map(s=>s.trim()).includes('eco');
 if(!r.OPENAI_API_KEY||r.OPENAI_API_KEY===x.LITELLM_MASTER_KEY)throw new Error('Configure a dedicated runtime virtual key');
 const root=new URL(r.OPENAI_BASE_URL??'');
 if(root.username||root.password||root.search||root.hash||!root.pathname.replace(/\/$/,'').endsWith('/v1')||!['https:','http:'].includes(root.protocol)||(root.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(root.hostname)))throw new Error('Invalid proxy root');
 let config=readFileSync(new URL('../deploy/litellm/config-kimi.yaml',import.meta.url),'utf8');
 for(const [band,model] of Object.entries(models)){
  const rate=rates[band];
  const routed=band!=='eco'||ecoProxy;
  verify(rate,model,now,routed);
  // Preserve Eco route and its billing identity/version exactly.
  if(band==='eco'&&rate.model!==(ecoProxy?'primary-eco':model))throw new Error('Eco snapshot does not match existing route');
  if(band!=='eco'){
   rate.model='primary-'+band;rate.responseModels=[rate.model,model];
   rate.version=rate.version.replace(/-kimi-proxy-r1$/,'')+'-kimi-proxy-r1';
  }
  const info={input_cost_per_token:Number(rate.inputUsdPerMillion)/1e6,output_cost_per_token:Number(rate.outputUsdPerMillion)/1e6,cache_read_input_token_cost:Number(rate.cacheUsdPerMillion)/1e6};
  if(band==='flagship')Object.assign(info,{cache_creation_input_token_cost:Number(rate.cacheWrite5mUsdPerMillion)/1e6,cache_creation_input_token_cost_above_1hr:Number(rate.cacheWrite1hUsdPerMillion)/1e6});
  config=config.replace('__'+band.toUpperCase()+'_RATES__',JSON.stringify(info));
 }
 const moonshot=r.MOONSHOT_API_KEY||x.MOONSHOT_API_KEY||(x.LITELLM_ROUTING_PROFILE==='kimi'?x.FLAGSHIP_UPSTREAM_API_KEY:undefined);
 const ds=ecoProxy?(x.DEEPSEEK_API_KEY||r.DEEPSEEK_API_KEY):(r.DEEPSEEK_API_KEY||x.DEEPSEEK_API_KEY);
 const zai=r.ZAI_API_KEY||x.ZAI_API_KEY;
 if(!moonshot||!ds||!zai)throw new Error('Missing official provider credentials');
 Object.assign(x,{DEEPSEEK_API_KEY:ds,ZAI_API_KEY:zai,FLAGSHIP_UPSTREAM_MODEL:'openai/kimi-k3.1-pro',FLAGSHIP_UPSTREAM_BASE_URL:'https://api.moonshot.ai/v1',FLAGSHIP_UPSTREAM_API_KEY:moonshot,LITELLM_ROUTING_PROFILE:'kimi',LITELLM_CONFIG_FILE:'/etc/piggybot/litellm-config.yaml'});
 for(const key of ['STANDARD_UPSTREAM_MODEL','STANDARD_UPSTREAM_BASE_URL','STANDARD_UPSTREAM_API_KEY','OPUS_UPSTREAM_API_KEY','MOONSHOT_API_KEY'])delete x[key];
 Object.assign(r,{AI_MODEL_ROUTING_MODE:'litellm',AI_PROXY_MODEL_PROFILE:'kimi',AI_PROXY_BANDS:ecoProxy?'eco,standard,flagship':'standard,flagship'});
 if(!ecoProxy)r.DEEPSEEK_API_KEY=ds;
 delete r.MOONSHOT_API_KEY;delete r.ZAI_API_KEY;
 p.AI_METERING_RATES_JSON=JSON.stringify(rates);
 validateLiteLlmEnvironment(x);
 return {platform:serialize(p),runtime:serialize(r),proxy:serialize(x),config};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const [out,rateFile]=process.argv.slice(2);if(!out)throw new Error('Missing new candidate directory');
  const result=prepareKimiProxy(readFileSync('/etc/piggybot/platform.env','utf8'),readFileSync('/etc/piggybot/ai-runtime.env','utf8'),readFileSync('/etc/piggybot/litellm.env','utf8'),rateFile?readFileSync(rateFile,'utf8'):undefined);
  mkdirSync(out,{mode:0o700});
  for(const [name,text] of Object.entries(result))writeFileSync(join(out,name==='config'?'config.yaml':name+'.env'),text,{mode:0o600,flag:'wx'});
  console.log('Protected GLM/Kimi proxy candidates prepared. Eco route and metering mode preserved; live files unchanged.');
 }catch{console.error('Preparation failed. Verify official-model USD rate snapshots including both Kimi TTL prices, credentials, proxy root and a new output directory. No live files changed.');process.exitCode=1;}
}
