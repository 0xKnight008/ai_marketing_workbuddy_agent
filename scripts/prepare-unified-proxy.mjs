import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const bands=['eco','standard','flagship'];
const official={eco:'deepseek-flash',standard:'glm-5.3-flash',flagship:'gpt-6-sol'};
export function prepareRouting(platformText,runtimeText,proxyText,selected){
 const routed=selected.split(',').map(s=>s.trim());
 if(!routed.includes('flagship')||new Set(routed).size!==routed.length||routed.some(b=>!bands.includes(b)))throw new Error('Invalid bands');
 const platform=parseEnv(platformText),runtime=parseEnv(runtimeText),proxy=parseEnv(proxyText);
 if(platform.AI_METERING_MODE!=='shadow')throw new Error('Migration candidates require shadow mode');
 if(!runtime.OPENAI_API_KEY||!runtime.OPENAI_BASE_URL)throw new Error('Missing runtime proxy credentials');
 const rates=JSON.parse(platform.AI_METERING_RATES_JSON??'');
 for(const band of bands){
  const rate=rates[band];
  if(!rate||!Array.isArray(rate.responseModels)||!rate.responseModels.includes(official[band]))throw new Error('Unexpected rate model');
  for(const field of ['inputUsdPerMillion','outputUsdPerMillion','cacheUsdPerMillion'])if(typeof rate[field]!=='string'||!/^\d+(?:\.\d{1,9})?$/.test(rate[field]))throw new Error('Invalid rate amount');
  if(!/^[a-zA-Z0-9_.-]{1,65}$/.test(rate.version))throw new Error('Invalid rate version');
  rate.model=routed.includes(band)?'primary-'+band:official[band];
  rate.responseModels=[...new Set([...rate.responseModels,'primary-'+band,official[band]])];
  rate.version=rate.version.replace(/-proxy-r1$/,'')+'-proxy-r1';
 }
 const update=(text,changes)=>{
  const env=parseEnv(text);
  // Serialize the complete candidate with strict quoting; never source it as shell code.
  Object.assign(env,changes);
  return Object.entries(env).map(([key,value])=>{
   if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||/[\r\n']/.test(value))throw new Error('Unsupported env encoding');
   return key+"='"+value+"'";
  }).join('\n')+'\n';
 };
 const ds=proxy.DEEPSEEK_API_KEY||runtime.DEEPSEEK_API_KEY,zai=proxy.ZAI_API_KEY||runtime.ZAI_API_KEY;
 if(!ds||!zai)throw new Error('Missing official provider credentials');
 let activeBand;
 const fields={input_cost_per_token:'inputUsdPerMillion',output_cost_per_token:'outputUsdPerMillion',cache_read_input_token_cost:'cacheUsdPerMillion'};
 const config=readFileSync(new URL('../deploy/litellm/config-unified.yaml',import.meta.url),'utf8').split('\n').map(line=>{
  const model=line.match(/^  - model_name: primary-(eco|standard|flagship)$/);if(model)activeBand=model[1];
  const field=line.match(/^      (input_cost_per_token|output_cost_per_token|cache_read_input_token_cost):/);
  return field&&['standard','flagship'].includes(activeBand)?'      '+field[1]+': '+Number(rates[activeBand][fields[field[1]]])/1000000:line;
 }).join('\n');
 return {
  config,
  platform:update(platformText,{AI_METERING_RATES_JSON:JSON.stringify(rates)}),
  runtime:update(runtimeText,{AI_MODEL_ROUTING_MODE:'litellm',AI_PROXY_BANDS:routed.join(',')}),
  proxy:update(proxyText,{DEEPSEEK_API_KEY:ds,ZAI_API_KEY:zai,LITELLM_ROUTING_PROFILE:'unified',LITELLM_CONFIG_FILE:'/etc/piggybot/litellm-config.yaml'}),
 };
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const [out,selected='standard,flagship']=process.argv.slice(2);if(!out)throw new Error('Missing candidate directory');
  const result=prepareRouting(readFileSync('/etc/piggybot/platform.env','utf8'),readFileSync('/etc/piggybot/ai-runtime.env','utf8'),readFileSync('/etc/piggybot/litellm.env','utf8'),selected);
  mkdirSync(out,{mode:0o700});
  for(const [name,text] of Object.entries(result))writeFileSync(join(out,name==='config'?'config.yaml':name+'.env'),text,{mode:0o600,flag:'wx'});
  console.log('Prepared protected candidates. Live env unchanged; verify virtual-key access before cutover.');
 }catch{console.error('Candidate preparation failed. Check shadow mode, all three verified rate profiles, provider credentials, env quoting, and a new output directory. No live env was changed.');process.exitCode=1;}
}
