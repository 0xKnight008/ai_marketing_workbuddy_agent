import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../config';
import { modelForBand } from './model-routing';
import { chatCompletionsModel } from './chat-completions-model';

const env = {
  NODE_ENV: 'production', AI_MODEL_ROUTING_MODE: 'three-channel',
  DEEPSEEK_API_KEY: 'ds-fixture', ZAI_API_KEY: 'zai-fixture', MOONSHOT_API_KEY: 'moonshot-fixture',
  MASTRA_STORAGE_URL: 'libsql://test.example',
};

test('three-channel primary models use isolated credentials and official model IDs', () => {
  const config = loadConfig(env);
  const cases = [
    ['eco', 'openai/deepseek-flash', 'https://api.deepseek.com/v1', env.DEEPSEEK_API_KEY],
    ['standard', 'openai/glm-5.3-flash', 'https://api.z.ai/api/paas/v4', env.ZAI_API_KEY],
    ['flagship', 'openai/kimi-k3.1-pro', 'https://api.moonshot.ai/v1', env.MOONSHOT_API_KEY],
  ] as const;
  for (const [band, id, url, apiKey] of cases) {
    assert.deepEqual(chatCompletionsModel(modelForBand(config, band, 'primary'), env), { id, url, apiKey });
  }
});

test('the three-channel profile needs no proxy root or proxy key', () => {
  const config = loadConfig(env);
  assert.equal(config.openAiBaseUrl, undefined);
  assert.equal(config.models.flagship, 'openai/piggy-kimi-flagship');
});

test('Eco fallback retains a separate logical alias but uses DeepSeek official', () => {
  const config = loadConfig(env);
  assert.notEqual(config.models.eco, config.fallbackModels.eco);
  assert.deepEqual(chatCompletionsModel(modelForBand(config, 'eco', 'fallback'), env),
    chatCompletionsModel(modelForBand(config, 'eco', 'primary'), env));
});

test('no task/quality/outage policy silently switches Standard or Flagship', () => {
  const config = loadConfig(env);
  for (const band of ['standard', 'flagship'] as const) {
    assert.equal(modelForBand(config, band, 'primary'), modelForBand(config, band, 'fallback'));
  }
  assert.throws(() => chatCompletionsModel('openai/unconfigured-model', env), /Unknown model alias/);
});

test('missing official keys fail closed, never borrowing another supplier key', () => {
  for (const name of ['DEEPSEEK_API_KEY', 'ZAI_API_KEY', 'MOONSHOT_API_KEY']) {
    assert.throws(() => loadConfig({ ...env, [name]: ' ' }), new RegExp(`Missing required env var: ${name}`));
  }
  assert.throws(() => chatCompletionsModel(loadConfig(env).models.eco, { ...env, DEEPSEEK_API_KEY: '' }), /DEEPSEEK_API_KEY/);
  assert.throws(() => chatCompletionsModel(loadConfig(env).models.flagship, { ...env, MOONSHOT_API_KEY: '' }), /MOONSHOT_API_KEY/);
});

test('legacy proxy transport is unchanged and does not require official keys', () => {
  const proxyRoot = 'http://127.0.0.1:3000/v1';
  const proxyEnv = {
    NODE_ENV: 'production', AI_MODEL_ROUTING_MODE: 'proxy' as const,
    OPENAI_BASE_URL: proxyRoot, OPENAI_API_KEY: 'router-fixture',
    AI_MODEL_ECO: 'openai/primary-eco', AI_MODEL_STANDARD: 'openai/primary-standard', AI_MODEL_FLAGSHIP: 'openai/primary-flagship',
    AI_MODEL_ECO_FALLBACK: 'openai/fallback-eco', AI_MODEL_STANDARD_FALLBACK: 'openai/fallback-standard', AI_MODEL_FLAGSHIP_FALLBACK: 'openai/fallback-flagship',
    MASTRA_STORAGE_URL: 'libsql://test.example',
  };
  loadConfig(proxyEnv);
  assert.deepEqual(chatCompletionsModel('openai/legacy-alias', {
    AI_MODEL_ROUTING_MODE: 'proxy', OPENAI_BASE_URL: proxyRoot, OPENAI_API_KEY: proxyEnv.OPENAI_API_KEY,
  }), { id: 'openai/legacy-alias', url: proxyRoot, apiKey: proxyEnv.OPENAI_API_KEY });
});
