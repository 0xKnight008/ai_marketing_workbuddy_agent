// Run with Node --env-file=/etc/piggybot/ai-runtime.env. No secrets are printed.
import {fileURLToPath} from 'node:url';
export async function checkFlagshipProxy(env=process.env,{generate=false,fetcher=fetch}={}){
 if(env.AI_MODEL_ROUTING_MODE!=='three-channel')throw new Error('Keep AI_MODEL_ROUTING_MODE=three-channel to preserve Eco/Standard direct routes');
 if(!env.DEEPSEEK_API_KEY||!env.ZAI_API_KEY)throw new Error('Existing direct-channel credentials must remain configured');
 if(env.AI_MODEL_FLAGSHIP!=='openai/primary-flagship')throw new Error('Expected the configured LiteLLM Flagship alias');
 if(!env.OPENAI_API_KEY||!env.OPENAI_BASE_URL)throw new Error('Configure the LiteLLM virtual key and API root');
 let base;try{base=new URL(env.OPENAI_BASE_URL)}catch{throw new Error('Invalid proxy API root')}
 if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||!base.pathname.replace(/\/$/,'').endsWith('/v1')||(base.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw new Error('Proxy requires a credential-free /v1 root and HTTPS outside loopback');
 const root=base.href.replace(/\/$/,''),headers={Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'};
 const call=async(url,init={})=>{let r;try{r=await fetcher(url,{...init,signal:AbortSignal.timeout(190000)})}catch{throw new Error('Proxy connection failed')};if(!r.ok)throw new Error(`Proxy check failed (HTTP ${r.status}); verify proxy/upstream credentials`);try{return await r.json()}catch{throw new Error('Proxy returned invalid JSON')};};
 await call(root.replace(/\/v1$/,'')+'/health/readiness');
 const models=await call(root+'/models',{headers});
 if(!models.data?.some(m=>m.id==='primary-flagship'))throw new Error('Virtual key cannot access primary-flagship');
 if(!generate)return {ok:true,mode:'read-only',alias:'primary-flagship'};
 const r=await call(root+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'primary-flagship',messages:[{role:'user',content:'Return JSON with ok true.'}],max_tokens:128,stream:false,response_format:{type:'json_schema',json_schema:{name:'probe',strict:true,schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}}})});
 let parsed;try{parsed=JSON.parse(r.choices?.[0]?.message?.content)}catch{throw new Error('Flagship structured output is invalid')}
 if(parsed?.ok!==true||!Number.isFinite(r.usage?.prompt_tokens)||!Number.isFinite(r.usage?.completion_tokens))throw new Error('Flagship response or token usage did not meet acceptance criteria');
 return {ok:true,mode:'paid-generation',alias:'primary-flagship',model:r.model,promptTokens:r.usage.prompt_tokens,completionTokens:r.usage.completion_tokens};
}
if(process.argv[1]===fileURLToPath(import.meta.url))checkFlagshipProxy(process.env,{generate:process.argv.includes('--generate')}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1});
