import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from './config';

const validProductionProxyEnv = {
  NODE_ENV: 'production',
  AI_MODEL_ROUTING_MODE: 'proxy',
  OPENAI_BASE_URL: 'https://router.internal.example/v1',
  OPENAI_API_KEY: 'router-issued-key',
  AI_MODEL_ECO: 'openai/primary-eco',
  AI_MODEL_STANDARD: 'openai/primary-standard',
  AI_MODEL_FLAGSHIP: 'openai/primary-flagship',
  AI_MODEL_ECO_FALLBACK: 'openai/fallback-eco',
  AI_MODEL_STANDARD_FALLBACK: 'openai/fallback-standard',
  AI_MODEL_FLAGSHIP_FALLBACK: 'openai/fallback-flagship',
  MASTRA_STORAGE_URL: 'libsql://runtime.internal.example',
} as const;

test('accepts a production OpenAI-compatible routing proxy configuration', () => {
  const loaded = loadConfig(validProductionProxyEnv);

  assert.equal(loaded.modelRoutingMode, 'proxy');
  assert.equal(loaded.openAiBaseUrl, 'https://router.internal.example/v1');
  assert.equal(loaded.models.standard, 'openai/primary-standard');
  assert.equal(loaded.fallbackModels.standard, 'openai/fallback-standard');
});

test('requires proxy routing mode in production', () => {
  assert.throws(
    () => loadConfig({ ...validProductionProxyEnv, AI_MODEL_ROUTING_MODE: 'direct' }),
    /AI_MODEL_ROUTING_MODE=proxy is required in production/,
  );
});

test('requires the routing proxy credentials and API root', () => {
  assert.throws(
    () => loadConfig({ ...validProductionProxyEnv, OPENAI_API_KEY: '  ' }),
    /Missing required env var: OPENAI_API_KEY/,
  );
  assert.throws(
    () => loadConfig({ ...validProductionProxyEnv, OPENAI_BASE_URL: 'https://router.internal.example' }),
    /OPENAI_BASE_URL must point to the routing proxy OpenAI API root ending in \/v1/,
  );
  assert.throws(
    () => loadConfig({ ...validProductionProxyEnv, OPENAI_BASE_URL: 'https://router.internal.example/v1?tenant=one' }),
    /OPENAI_BASE_URL must not contain a query string or fragment/,
  );
});

test('requires a fallback alias for every model band', () => {
  const { AI_MODEL_STANDARD_FALLBACK: _, ...missingFallback } = validProductionProxyEnv;
  assert.throws(
    () => loadConfig(missingFallback),
    /Missing required env var: AI_MODEL_STANDARD_FALLBACK/,
  );
});

test('requires proxy aliases to use Mastra openai model strings', () => {
  assert.throws(
    () => loadConfig({ ...validProductionProxyEnv, AI_MODEL_ECO_FALLBACK: 'moonshot/kimi-k2' }),
    /Proxy-routed eco models must use openai\/<router-alias>/,
  );
});

test('rejects a fallback alias that is identical to its primary alias', () => {
  assert.throws(
    () => loadConfig({ ...validProductionProxyEnv, AI_MODEL_FLAGSHIP_FALLBACK: 'openai/primary-flagship' }),
    /Primary and fallback flagship model aliases must be different/,
  );
});

test('keeps direct routing available outside production', () => {
  const loaded = loadConfig({
    AI_MODEL_ROUTING_MODE: 'direct',
    AI_MODEL_ECO: 'openai/gpt-4o-mini',
  });

  assert.equal(loaded.modelRoutingMode, 'direct');
  assert.equal(loaded.openAiBaseUrl, undefined);
  assert.equal(loaded.fallbackModels.eco, undefined);
});
