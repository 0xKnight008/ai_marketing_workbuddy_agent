import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../config';
import { modelForBand } from './model-routing';
import { chatCompletionsModel } from './chat-completions-model';

const env = {
  NODE_ENV: 'production', AI_MODEL_ROUTING_MODE: 'three-channel',
  OPENAI_BASE_URL: 'http://127.0.0.1:3000/v1', OPENAI_API_KEY: 'proxy-test-key',
  AI_MODEL_FLAGSHIP: 'openai/existing-sol-alias',
  DEEPSEEK_API_KEY: 'deepseek-test-key', ZAI_API_KEY: 'zai-test-key',
  MASTRA_STORAGE_URL: 'libsql://test.example',
};

test('three-channel primary models use isolated credentials and official model IDs', () => {
  const config = loadConfig(env);
  const cases = [
    ['eco', 'openai/deepseek-flash', 'https://api.deepseek.com/v1', env.DEEPSEEK_API_KEY],
    ['standard', 'openai/glm-5.3-flash', 'https://api.z.ai/api/paas/v4', env.ZAI_API_KEY],
    ['flagship', env.AI_MODEL_FLAGSHIP, env.OPENAI_BASE_URL, env.OPENAI_API_KEY],
  ] as const;
  for (const [band, id, url, apiKey] of cases) {
    assert.deepEqual(chatCompletionsModel(modelForBand(config, band, 'primary'), env), { id, url, apiKey });
  }
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

test('missing official keys fail closed, never borrowing the proxy key', () => {
  for (const name of ['DEEPSEEK_API_KEY', 'ZAI_API_KEY', 'OPENAI_API_KEY', 'AI_MODEL_FLAGSHIP']) {
    assert.throws(() => loadConfig({ ...env, [name]: ' ' }), new RegExp(`Missing required env var: ${name}`));
  }
  assert.throws(() => chatCompletionsModel(loadConfig(env).models.eco, { ...env, DEEPSEEK_API_KEY: '' }), /DEEPSEEK_API_KEY/);
});

test('rejects unsafe proxy roots and official-channel alias collisions', () => {
  for (const url of ['https://user:secret@proxy.example/v1', 'https://proxy.example/v1?key=secret', 'http://proxy.example/v1', 'https://proxy.example']) {
    assert.throws(() => loadConfig({ ...env, OPENAI_BASE_URL: url }));
  }
  assert.throws(() => loadConfig({ ...env, AI_MODEL_FLAGSHIP: loadConfig(env).models.eco }), /must not reuse/);
});

test('legacy proxy transport is unchanged and does not require official keys', () => {
  assert.deepEqual(chatCompletionsModel('openai/legacy-alias', {
    AI_MODEL_ROUTING_MODE: 'proxy', OPENAI_BASE_URL: env.OPENAI_BASE_URL, OPENAI_API_KEY: env.OPENAI_API_KEY,
  }), { id: 'openai/legacy-alias', url: env.OPENAI_BASE_URL, apiKey: env.OPENAI_API_KEY });
});
