import {fileURLToPath} from 'node:url';
export async function checkUnifiedProxy(env=process.env,{fetcher=fetch}={}){
 if(env.AI_MODEL_ROUTING_MODE!=='litellm')throw new Error('Expected AI_MODEL_ROUTING_MODE=litellm');
 const bands=(env.AI_PROXY_BANDS??'eco,standard,flagship').split(',').map(b=>b.trim());
 if(!bands.includes('flagship')||bands.some(b=>!['eco','standard','flagship'].includes(b)))throw new Error('Invalid proxy bands');
 const base=new URL(env.OPENAI_BASE_URL??'');
 if(!env.OPENAI_API_KEY||base.username||base.password||base.search||base.hash||!base.pathname.replace(/\/$/,'').endsWith('/v1')||!['http:','https:'].includes(base.protocol)||(base.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw new Error('Invalid proxy root or key');
 const root=base.href.replace(/\/$/,'');
 const get=async(url,headers)=>{let r;try{r=await fetcher(url,{headers,signal:AbortSignal.timeout(10000)})}catch{throw new Error('Proxy connection failed')};if(!r.ok)throw new Error('Proxy check failed: HTTP '+r.status);try{return await r.json()}catch{throw new Error('Proxy returned invalid JSON')}};
 await get(root.replace(/\/v1$/,'')+'/health/readiness');
 const models=await get(root+'/models',{Authorization:'Bearer '+env.OPENAI_API_KEY});
 for(const band of bands)if(!models.data?.some(m=>m.id==='primary-'+band))throw new Error('Virtual key cannot access primary-'+band);
 return {ok:true,mode:'read-only',bands};
}
if(process.argv[1]===fileURLToPath(import.meta.url))checkUnifiedProxy().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Proxy preflight failed; check readiness, root and virtual-key model permissions.');process.exitCode=1});
