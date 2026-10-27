import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
export function validateLiteLlmEnvironment(env){
 const required=['LITELLM_IMAGE','LITELLM_POSTGRES_IMAGE','LITELLM_DB_PASSWORD','LITELLM_MASTER_KEY','LITELLM_SALT_KEY','FLAGSHIP_UPSTREAM_MODEL','FLAGSHIP_UPSTREAM_BASE_URL','FLAGSHIP_UPSTREAM_API_KEY'];
 for(const name of required)if(!env[name]?.trim())throw new Error(`Missing ${name}`);
 for(const name of ['LITELLM_IMAGE','LITELLM_POSTGRES_IMAGE'])if(!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(env[name]))throw new Error(`${name} must be pinned by sha256 digest`);
 if(!/^[a-f0-9]{64}$/.test(env.LITELLM_DB_PASSWORD))throw new Error('LITELLM_DB_PASSWORD must be 32 random bytes encoded as hex');
 for(const name of ['LITELLM_MASTER_KEY','LITELLM_SALT_KEY'])if(!/^sk-[a-f0-9]{64}$/.test(env[name]))throw new Error(`${name} must use sk- followed by 32 random bytes encoded as hex`);
 if(env.LITELLM_MASTER_KEY===env.LITELLM_SALT_KEY)throw new Error('Master key and salt must be different');
 if(!/^openai\/[^\s]+$/.test(env.FLAGSHIP_UPSTREAM_MODEL))throw new Error('FLAGSHIP_UPSTREAM_MODEL must be openai/<reviewed compatible wire model>');
 let url;try{url=new URL(env.FLAGSHIP_UPSTREAM_BASE_URL)}catch{throw new Error('Invalid FLAGSHIP_UPSTREAM_BASE_URL')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.replace(/\/$/,'').endsWith('/v1'))throw new Error('Flagship upstream requires a credential-free HTTPS API root ending in /v1');
 if(env.LITELLM_ROUTING_PROFILE && env.LITELLM_ROUTING_PROFILE!=='unified')throw new Error('Invalid LITELLM_ROUTING_PROFILE');
 if(env.LITELLM_ROUTING_PROFILE==='unified'){
  for(const key of ['DEEPSEEK_API_KEY','ZAI_API_KEY'])if(!env[key]?.trim())throw new Error(`Missing ${key}`);
  if(env.LITELLM_CONFIG_FILE!=='/etc/piggybot/litellm-config.yaml')throw new Error('Unified routing requires server-owned /etc/piggybot/litellm-config.yaml');
  if(env.FLAGSHIP_UPSTREAM_MODEL!=='openai/gpt-6-sol')throw new Error('Unified pricing requires the reviewed openai/gpt-6-sol contract');
 }
 return true;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{validateLiteLlmEnvironment(parseEnv(readFileSync(process.argv[2]??'/etc/piggybot/litellm.env','utf8')));console.log('PASS: pinned proxy/database images and required proxy configuration are present. No upstream request was sent.');}
 catch(error){console.error(error.message);process.exitCode=1;}
}
