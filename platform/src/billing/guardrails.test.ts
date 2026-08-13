import assert from 'node:assert/strict';
import test from 'node:test';

import { guardrailStatus, monthlyZernioMicros, supplierActionCostMicros } from './guardrails';
import { PLAN_CATALOG } from './plans';

test('Growth can connect its promised ten accounts without the Zernio guardrail pausing it', () => {
  const connectedAccounts = 10;
  const monthlyCostMicros = monthlyZernioMicros(connectedAccounts);
  const spendLimitMicros = PLAN_CATALOG.growth.supplierSpendLimitCents * 10_000;

  assert.equal(monthlyCostMicros, 1_500_000); // $15.00 at the aggregated $1.50/account rate.
  assert.equal(guardrailStatus(0, PLAN_CATALOG.growth.taskQuota, monthlyCostMicros, spendLimitMicros), 'normal');
});

test('prices X supplier spend by action and detects links in posts', () => {
  assert.equal(supplierActionCostMicros({ platform: 'x', actionType: 'social.create_post', payload: { content: 'Hello' } }), 15_000);
  assert.equal(supplierActionCostMicros({ platform: 'x', actionType: 'social.create_post', payload: { content: 'Read https://piggybot.me' } }), 200_000);
  assert.equal(supplierActionCostMicros({ platform: 'x', actionType: 'social.get_analytics' }), 5_000);
  assert.equal(supplierActionCostMicros({ platform: 'linkedin', actionType: 'social.create_post' }), 0);
});
