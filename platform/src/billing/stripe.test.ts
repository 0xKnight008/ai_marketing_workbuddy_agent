import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { stripeActivationFromWebhook, verifyStripeWebhookSignature } from './stripe';

const secret = 'whsec_test_secret';
const timestamp = 1_900_000_000;
const checkoutEvent = JSON.stringify({
  id: 'evt_checkout_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      payment_status: 'no_payment_required',
      customer: 'cus_123',
      subscription: 'sub_123',
      metadata: { workspaceId: '00000000-0000-4000-8000-000000000001', plan: 'growth' },
    },
  },
});

test('accepts a current Stripe v1 signature and rejects a modified payload', () => {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${checkoutEvent}`).digest('hex');
  assert.doesNotThrow(() => verifyStripeWebhookSignature(checkoutEvent, `t=${timestamp},v1=${signature}`, secret, 300, timestamp));
  assert.throws(() => verifyStripeWebhookSignature(`${checkoutEvent} `, `t=${timestamp},v1=${signature}`, secret, 300, timestamp), /stripe_signature_invalid/);
});

test('turns only a paid or trial Checkout event with scoped metadata into an activation', () => {
  const activation = stripeActivationFromWebhook(checkoutEvent, 7);
  assert.deepEqual({
    eventId: activation?.eventId,
    workspaceId: activation?.workspaceId,
    plan: activation?.plan,
    subscriptionStatus: activation?.subscriptionStatus,
    customerId: activation?.customerId,
  }, {
    eventId: 'evt_checkout_1',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    plan: 'growth',
    subscriptionStatus: 'trialing',
    customerId: 'cus_123',
  });
});
