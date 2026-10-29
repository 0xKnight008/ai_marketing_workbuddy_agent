import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateLiteLlmEnvironment} from './litellm-preflight.mjs';
const serialize=env=>Object.entries(env).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>{
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||/[\r\n']/.test(value))throw new Error('Unsupported env encoding');
 return key+"='"+value+"'";
}).join('\n')+'\n';
export function prepareOneToken(platformText,runtimeText,proxyText,at=new Date().toISOString()){
 const p=parseEnv(platformText),r=parseEnv(runtimeText),x=parseEnv(proxyText);
 if(p.AI_METERING_MODE!=='shadow')throw new Error('Migration requires shadow mode');
 if(r.AI_MODEL_ROUTING_MODE!=='litellm'||r.AI_PROXY_BANDS!=='eco,standard,flagship')throw new Error('Migration requires all three proxy bands');
 const old=JSON.parse(p.AI_METERING_RATES_JSON??'');
 if(old.eco?.model!=='primary-eco'||!old.eco?.responseModels?.includes('deepseek-flash'))throw new Error('Unexpected Eco profile');
 const migrated=x.LITELLM_ROUTING_PROFILE==='onetoken';
 if(!migrated&&x.FLAGSHIP_UPSTREAM_MODEL!=='openai/gpt-6-sol')throw new Error('Expected existing GPT contract');
 const gptKey=migrated?x.STANDARD_UPSTREAM_API_KEY:x.FLAGSHIP_UPSTREAM_API_KEY;
 const opusKey=x.OPUS_UPSTREAM_API_KEY||(migrated?x.FLAGSHIP_UPSTREAM_API_KEY:undefined);
 const base=migrated?x.STANDARD_UPSTREAM_BASE_URL:x.FLAGSHIP_UPSTREAM_BASE_URL;
 if(!gptKey||!opusKey||!base||new URL(base).hostname!=='api.1token.ai')throw new Error('Missing verified 1Token credentials or root');
 const rate=(band,model,input,output)=>({version:'onetoken-'+band+'-'+at.slice(0,10),model:'primary-'+band,responseModels:['primary-'+band,model],inputUsdPerMillion:input,cacheUsdPerMillion:'0.2',outputUsdPerMillion:output,source:'1Token operator-confirmed contract',verifiedAt:at,currency:'USD'});
 const standard=rate('standard','gpt-6-sol','2','10');
 const flagship={...rate('flagship','claude-opus-5-5','4','20'),cacheWrite5mUsdPerMillion:'5',cacheWrite1hUsdPerMillion:'8'};
 r.AI_PROXY_MODEL_PROFILE='onetoken';
 p.AI_METERING_RATES_JSON=JSON.stringify({eco:old.eco,standard,flagship});
 Object.assign(x,{STANDARD_UPSTREAM_MODEL:'openai/gpt-6-sol',STANDARD_UPSTREAM_BASE_URL:base,STANDARD_UPSTREAM_API_KEY:gptKey,FLAGSHIP_UPSTREAM_MODEL:'openai/claude-opus-5-5',FLAGSHIP_UPSTREAM_BASE_URL:base,FLAGSHIP_UPSTREAM_API_KEY:opusKey,LITELLM_ROUTING_PROFILE:'onetoken',LITELLM_CONFIG_FILE:'/etc/piggybot/litellm-config.yaml'});
 for(const env of [p,r,x])delete env.ZAI_API_KEY;
 delete x.OPUS_UPSTREAM_API_KEY;
 validateLiteLlmEnvironment(x);
 return {platform:serialize(p),runtime:serialize(r),proxy:serialize(x),config:readFileSync(new URL('../deploy/litellm/config-onetoken.yaml',import.meta.url),'utf8')};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const out=process.argv[2];if(!out)throw new Error('Missing candidate directory');
  const result=prepareOneToken(readFileSync('/etc/piggybot/platform.env','utf8'),readFileSync('/etc/piggybot/ai-runtime.env','utf8'),readFileSync('/etc/piggybot/litellm.env','utf8'));
  mkdirSync(out,{mode:0o700});
  for(const [name,text] of Object.entries(result))writeFileSync(join(out,name==='config'?'config.yaml':name+'.env'),text,{mode:0o600,flag:'wx'});
  console.log('Prepared protected 1Token candidates. Live configuration unchanged.');
 }catch{console.error('Candidate preparation failed: verify shadow mode, proxy bands, existing GPT key, OPUS_UPSTREAM_API_KEY and a new directory.');process.exitCode=1;}
}
