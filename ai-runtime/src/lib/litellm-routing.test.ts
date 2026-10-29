import test from 'node:test';
import assert from 'node:assert/strict';
import {usesJsonObject} from './litellm-routing';
import {loadConfig} from '../config';
import {chatCompletionsModel} from './chat-completions-model';
import {structuredOutputForBand} from './structured-output';
const env={NODE_ENV:'production',AI_MODEL_ROUTING_MODE:'litellm',OPENAI_BASE_URL:'http://127.0.0.1:4400/v1',OPENAI_API_KEY:'virtual-fixture',MASTRA_STORAGE_URL:'libsql://test.example'};
test('all three bands use the same proxy key with distinct aliases and no automatic provider switch',()=>{
 const config=loadConfig(env);
 for(const band of ['eco','standard','flagship'] as const){
  assert.deepEqual(chatCompletionsModel(config.models[band],env),{id:'openai/primary-'+band,url:env.OPENAI_BASE_URL,apiKey:env.OPENAI_API_KEY});
  assert.equal(config.models[band],config.fallbackModels[band]);
  assert.equal(structuredOutputForBand({},band,env).jsonPromptInjection,band==='flagship'?undefined:true);
 }
 assert.throws(()=>chatCompletionsModel('openai/unknown',env),/Unknown model/);
});
test('staged Standard migration keeps Eco direct and fails closed without its key',()=>{
 const partial={...env,AI_PROXY_BANDS:'standard,flagship',DEEPSEEK_API_KEY:'official-fixture'};
 const config=loadConfig(partial);
 assert.deepEqual(chatCompletionsModel(config.models.eco,partial),{id:'openai/deepseek-flash',url:'https://api.deepseek.com/v1',apiKey:'official-fixture'});
 assert.throws(()=>loadConfig({...partial,DEEPSEEK_API_KEY:''}),/DEEPSEEK_API_KEY/);
});
test('rejects unsafe proxy roots and invalid rollout band lists',()=>{
 for(const value of ['eco','standard,flagship,standard','flagship,unknown',''])assert.throws(()=>loadConfig({...env,AI_PROXY_BANDS:value}));
 for(const value of ['http://remote.example/v1','https://key:secret@proxy.example/v1','https://proxy.example/v1?key=secret'])assert.throws(()=>loadConfig({...env,OPENAI_BASE_URL:value}));
});


test('1Token Opus uses prompt-injected JSON with no ZAI credentials or partial routing',()=>{
 const next={...env,AI_PROXY_MODEL_PROFILE:'onetoken'};
 const config=loadConfig(next);
 assert.equal(usesJsonObject('primary-flagship',next),true);
 assert.equal(usesJsonObject('primary-flagship',env),false);
 assert.equal(structuredOutputForBand({},'flagship',next).jsonPromptInjection,true);
 assert.deepEqual(chatCompletionsModel(config.models.flagship,next),{id:'openai/primary-flagship',url:env.OPENAI_BASE_URL,apiKey:env.OPENAI_API_KEY});
 assert.throws(()=>loadConfig({...next,AI_PROXY_BANDS:'standard,flagship',DEEPSEEK_API_KEY:'fixture'}),/all three/);
 assert.throws(()=>loadConfig({...next,AI_PROXY_MODEL_PROFILE:'unknown'}),/Unknown/);
});
