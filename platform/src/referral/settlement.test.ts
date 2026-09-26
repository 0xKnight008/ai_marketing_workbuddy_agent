import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReferralRetryWindow, referralCents } from './settlement';
import { stripeInvoicePaidFromWebhook } from '../billing/stripe';

test('referral amounts are exact whole USD cents within cap', () => {
  assert.equal(referralCents('2000000000', 'usd'), 200000);
  for (const amount of ['0', '-10000', '9999', '10001', '2000010000', '9223372036854775807']) {
    assert.throws(() => referralCents(amount, 'usd'));
  }
  assert.throws(() => referralCents('10000', 'eur'));
});

test('uncertain settlement never retries outside the bounded idempotency window', () => {
  const now = Date.now();
  assert.doesNotThrow(() => assertReferralRetryWindow(new Date(now - 19 * 3600000).toISOString(), now));
  for (const at of [null, 'invalid', new Date(now - 20 * 3600000).toISOString()]) {
    assert.throws(() => assertReferralRetryWindow(at, now), /requires_reconciliation/);
  }
});

test('invoice parsing refuses non-USD, unsafe integers, fractions and negative values', () => {
  const parse = (amount: number, currency = 'usd') => stripeInvoicePaidFromWebhook(JSON.stringify({
    id: 'evt_money', type: 'invoice.paid', data: { object: { id: 'in_money', amount_paid: amount, currency,
      metadata: { workspaceId: '11111111-1111-4111-8111-111111111111' } } },
  }));
  assert.equal(parse(1)?.paidMicros, 10000);
  for (const amount of [Number.MAX_SAFE_INTEGER, 900719925475, 1.1, -1, 0]) assert.equal(parse(amount), undefined);
  assert.equal(parse(100, 'eur'), undefined);
});
