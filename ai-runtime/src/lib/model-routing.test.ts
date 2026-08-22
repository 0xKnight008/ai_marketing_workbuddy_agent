import assert from 'node:assert/strict';
import test from 'node:test';

import { modelForBand } from './model-routing';

const routingConfig = {
  models: {
    eco: 'openai/primary-eco',
    standard: 'openai/primary-standard',
    flagship: 'openai/primary-flagship',
  },
  fallbackModels: {
    eco: 'openai/fallback-eco',
    standard: undefined,
    flagship: 'openai/fallback-flagship',
  },
} as const;

test('selects the requested primary or fallback router alias', () => {
  assert.equal(modelForBand(routingConfig, 'eco', 'primary'), 'openai/primary-eco');
  assert.equal(modelForBand(routingConfig, 'eco', 'fallback'), 'openai/fallback-eco');
});

test('does not silently use the primary alias when a fallback is missing', () => {
  assert.throws(
    () => modelForBand(routingConfig, 'standard', 'fallback'),
    /AI_MODEL_STANDARD_FALLBACK is not configured/,
  );
});
