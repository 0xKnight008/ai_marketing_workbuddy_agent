import assert from 'node:assert/strict';
import test from 'node:test';

import { guardrailStatus, monthlyZernioMicros, projectedActionUsage, reserveAiRun, supplierActionCostMicros, usageSnapshot, requireAutomationAccess } from './guardrails';
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

function usageTransaction(taskUsed: number, supplierSpendMicros = 0, subscriptionStatus = 'active', endsAt: string | null = null, trialCreditsUsed = 0): { inserted: unknown[][]; tx: TenantTransaction } {
  const inserted: unknown[][] = [];
  const query = async (sql: string, values: readonly unknown[] = []) => {
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus, trialEndsAt: endsAt, paymentGraceEndsAt: endsAt }], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed, aiCreditsUsed: 0, supplierSpendMicros }], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }], rowCount: 1 };
      if (sql.includes('AS "trialCreditsUsed"')) return { rows: [{ trialCreditsUsed }], rowCount: 1 };
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

for (const status of ['inactive', 'past_due', 'canceled', 'unpaid', 'incomplete', 'trialing', 'unknown']) {
  test(`${status} cannot reserve AI, publish, or create runs without a valid entitlement`, async () => {
    const { tx, inserted } = usageTransaction(0, 0, status);
    assert.equal((await usageSnapshot(tx)).status, 'paused');
    assert.equal((await reserveAiRun(tx, ['eco'], 'run-1')).guardrail.status, 'paused');
    assert.equal((await projectedActionUsage(tx, { platform: 'linkedin', actionType: 'social.create_post' })).status, 'paused');
    await assert.rejects(() => requireAutomationAccess(tx), /automation_paused/);
    assert.equal(inserted.length, 0);
  });
}

test('payment grace preserves approval requirements without bypassing the hard spend cap', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const { tx } = usageTransaction(0, 0, 'past_due', future);
  assert.equal((await reserveAiRun(tx, ['eco'], 'run-1')).guardrail.status, 'approval_required');
  assert.equal((await projectedActionUsage(tx, { platform: 'linkedin', actionType: 'social.create_post' })).status, 'approval_required');
  const capped = usageTransaction(0, PLAN_CATALOG.creator.supplierSpendLimitCents * 10_000, 'past_due', future);
  assert.equal((await usageSnapshot(capped.tx)).status, 'paused');
});

test('active trials and explicit manual entitlements work; expired trials do not', async () => {
  assert.equal((await usageSnapshot(usageTransaction(0, 0, 'trialing', new Date(Date.now() + 60_000).toISOString()).tx)).status, 'normal');
  assert.equal((await usageSnapshot(usageTransaction(0, 0, 'manual').tx)).status, 'normal');
  assert.equal((await usageSnapshot(usageTransaction(0, 0, 'trialing', '2020-01-01T00:00:00Z').tx)).status, 'paused');
});

test('trial stops at thirty cumulative AI credits even when monthly usage is zero', async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const remaining = await usageSnapshot(usageTransaction(0, 0, 'trialing', future, 29).tx);
  assert.equal(remaining.status, 'normal');
  assert.equal(remaining.aiCreditsAvailable, 1);
  assert.equal(remaining.aiCreditsUsed, 29);
  const exhausted = usageTransaction(0, 0, 'trialing', future, 30);
  assert.equal((await usageSnapshot(exhausted.tx)).status, 'paused');
  assert.equal((await usageSnapshot(exhausted.tx)).aiCreditsAvailable, 0);
  await assert.rejects(requireAutomationAccess(exhausted.tx), /automation_paused/);
  assert.equal((await reserveAiRun(exhausted.tx, ['eco'], 'run-1')).guardrail.status, 'paused');
});

test('projects the exact X linked-post supplier cost', async () => {
  const { tx } = usageTransaction(0);
  const projected = await projectedActionUsage(tx, { platform: 'x', actionType: 'social.create_post', payload: { content: 'Visit https://piggybot.me' } });
  assert.equal(projected.supplierSpendMicros, 200_000);
});

// ---------- 迭代 5：无 workflow_run 的 AI 主题计量（import_batch / insight_report） ----------

test('reserveAiRun charges a subject-metered run once with the action prefix', async () => {
  const { inserted, tx } = usageTransaction(0);
  const reservation = await reserveAiRun(tx, ['standard'], { subjectId: 'batch-1', attempt: 7, actionType: 'ai.classify' }, 'standard');
  assert.equal(reservation.band, 'standard');
  assert.equal(reservation.credits, 6);
  assert.equal(reservation.charged, true);
  const event = inserted[0]!;
  assert.equal(event[0], null); // run_id
  assert.equal(event[1], 'batch-1'); // subject_id
  assert.equal(event[2], 6); // ai_credits
  assert.equal(event[5], 7); // attempt
  assert.equal(event[6], 'ai.classify.standard.primary');
});

test('reserveAiRun with a subject pauses instead of charging when credits are exhausted', async () => {
  const inserted: unknown[][] = [];
  const query = async (sql: string, values: readonly unknown[] = []) => {
    if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }], rowCount: 1 };
    if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 400, supplierSpendMicros: 0 }], rowCount: 1 };
    if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }], rowCount: 1 };
    inserted.push([...values]);
    return { rows: [], rowCount: 1 };
  };
  const tx = { query: query as TenantTransaction['query'] } as TenantTransaction;
  const reservation = await reserveAiRun(tx, ['eco'], { subjectId: 'report-1', actionType: 'ai.insight' }, 'eco');
  assert.equal(reservation.guardrail.status, 'paused');
  assert.equal(reservation.credits, 0);
  assert.equal(reservation.charged, false);
  assert.equal(inserted.length, 0);
});

test('reserveAiRun requires a subject', async () => {
  const { tx } = usageTransaction(0);
  await assert.rejects(() => reserveAiRun(tx, ['eco'], {} as never), /subject is missing/);
});
