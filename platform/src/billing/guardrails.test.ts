import assert from 'node:assert/strict';
import test from 'node:test';

import { guardrailStatus, monthlyZernioMicros, projectedActionUsage, reserveAiRun, supplierActionCostMicros } from './guardrails';
import type { TenantTransaction } from '../foundation/database';
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

test('degrades on exhausted task quota but pauses on exhausted supplier spend', () => {
  assert.equal(guardrailStatus(100, 100, 0, 1_000_000), 'degraded');
  assert.equal(guardrailStatus(0, 100, 1_000_000, 1_000_000), 'paused');
});

function usageTransaction(taskUsed: number, supplierSpendMicros = 0): { inserted: unknown[][]; tx: TenantTransaction } {
  const inserted: unknown[][] = [];
  const query = async (sql: string, values: readonly unknown[] = []) => {
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed, aiCreditsUsed: 0, supplierSpendMicros }], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }], rowCount: 1 };
      inserted.push([...values]);
      return { rows: [], rowCount: 1 };
  };
  const tx: TenantTransaction = { query: query as TenantTransaction['query'] };
  return { inserted, tx };
}

test('charges Eco credits when a Standard request is degraded', async () => {
  const { inserted, tx } = usageTransaction(2_000);
  const reservation = await reserveAiRun(tx, ['standard'], 'run-1');
  assert.equal(reservation.band, 'eco');
  assert.equal(reservation.provider, 'fallback');
  assert.equal(reservation.credits, 1);
  assert.equal(inserted[0]?.[2], 1);
});

test('projects the exact X linked-post supplier cost', async () => {
  const { tx } = usageTransaction(0);
  const projected = await projectedActionUsage(tx, { platform: 'x', actionType: 'social.create_post', payload: { content: 'Visit https://piggybot.me' } });
  assert.equal(projected.supplierSpendMicros, 200_000);
});
