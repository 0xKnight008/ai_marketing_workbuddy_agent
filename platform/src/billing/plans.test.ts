import assert from 'node:assert/strict';
import test from 'node:test';

import { guardrailStatus } from './guardrails';
import { MODEL_BAND_POLICIES, PLAN_CATALOG, requestedModelBand } from './plans';

test('uses the published Pricing v2 plan entitlements', () => {
  assert.deepEqual(PLAN_CATALOG.creator, { priceCents: 1_900, taskQuota: 2_000, aiCredits: 400, supplierSpendLimitCents: 600 });
  assert.deepEqual(PLAN_CATALOG.growth, { priceCents: 5_900, taskQuota: 10_000, aiCredits: 2_500, supplierSpendLimitCents: 2_000 });
  assert.deepEqual(PLAN_CATALOG.agency, { priceCents: 16_900, taskQuota: 50_000, aiCredits: 8_000, supplierSpendLimitCents: 5_500 });
});

test('selects the highest requested model band and preserves Eco fallback policy', () => {
  assert.equal(requestedModelBand(['eco']), 'eco');
  assert.equal(requestedModelBand(['eco', 'standard']), 'standard');
  assert.equal(requestedModelBand(['standard', 'flagship']), 'flagship');
  assert.equal(MODEL_BAND_POLICIES.eco.credits, 1);
  assert.equal(MODEL_BAND_POLICIES.flagship.maxTargets, 20);
});

test('requires approval at 80 percent and pauses at the hard limit', () => {
  assert.equal(guardrailStatus(1_599, 2_000, 100, 600 * 10_000), 'normal');
  assert.equal(guardrailStatus(1_600, 2_000, 100, 600 * 10_000), 'approval_required');
  assert.equal(guardrailStatus(1_600, 2_000, 600 * 10_000, 600 * 10_000), 'paused');
});
