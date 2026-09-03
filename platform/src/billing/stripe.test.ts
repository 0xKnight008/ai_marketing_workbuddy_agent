import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { stripeActivationFromWebhook, stripeInvoicePaidFromWebhook, stripeSubscriptionStatusFromWebhook, verifyStripeWebhookSignature } from './stripe';

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
      metadata: {
        workspaceId: '00000000-0000-4000-8000-000000000001',
        actorId: '00000000-0000-4000-8000-000000000002',
        plan: 'growth',
      },
    },
  },
});

test('accepts a current Stripe v1 signature and rejects a modified payload', () => {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${checkoutEvent}`).digest('hex');
  assert.doesNotThrow(() => verifyStripeWebhookSignature(checkoutEvent, `t=${timestamp},v1=${signature}`, secret, 300, timestamp));
  assert.throws(() => verifyStripeWebhookSignature(`${checkoutEvent} `, `t=${timestamp},v1=${signature}`, secret, 300, timestamp), /stripe_signature_invalid/);
});

test('turns only a paid or trial Checkout event with scoped metadata into an activation', () => {
  const activation = stripeActivationFromWebhook(checkoutEvent);
  assert.deepEqual({
    eventId: activation?.eventId,
    workspaceId: activation?.workspaceId,
    actorId: activation?.actorId,
    plan: activation?.plan,
    subscriptionStatus: activation?.subscriptionStatus,
    customerId: activation?.customerId,
  }, {
    eventId: 'evt_checkout_1',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    actorId: '00000000-0000-4000-8000-000000000002',
    plan: 'growth',
    subscriptionStatus: 'active',
    customerId: 'cus_123',
  });
});

test('turns a subscription cancellation into an immediate inactive entitlement', () => {
  const update = stripeSubscriptionStatusFromWebhook(JSON.stringify({
    id: 'evt_cancel_1',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_123', customer: 'cus_123', metadata: { workspaceId: '00000000-0000-4000-8000-000000000001', plan: 'growth' } } },
  }), 7);
  assert.deepEqual(update, {
    eventId: 'evt_cancel_1',
    eventType: 'customer.subscription.deleted',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    subscriptionId: 'sub_123',
    customerId: 'cus_123',
    subscriptionStatus: 'inactive',
  });
});

test('places payment failures into a bounded grace period and restores status on subscription update', () => {
  const now = new Date('2026-08-10T00:00:00.000Z');
  const failed = stripeSubscriptionStatusFromWebhook(JSON.stringify({
    id: 'evt_invoice_failed_1',
    type: 'invoice.payment_failed',
    data: { object: { customer: 'cus_123', subscription: 'sub_123', subscription_details: { metadata: { workspaceId: '00000000-0000-4000-8000-000000000001' } } } },
  }), 7, now);
  assert.equal(failed?.subscriptionStatus, 'past_due');
  assert.equal(failed?.paymentGraceEndsAt, '2026-08-17T00:00:00.000Z');

  const restored = stripeSubscriptionStatusFromWebhook(JSON.stringify({
    id: 'evt_subscription_updated_1',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_123', customer: 'cus_123', status: 'active', metadata: { workspaceId: '00000000-0000-4000-8000-000000000001' } } },
  }), 7, now);
  assert.equal(restored?.subscriptionStatus, 'active');
});

test('uses the invoice amount actually paid when accruing referral credit', () => {
  const invoice = stripeInvoicePaidFromWebhook(JSON.stringify({
    id: 'evt_invoice_paid_1', type: 'invoice.paid',
    data: { object: { id: 'in_123', amount_paid: 5900, currency: 'usd', subscription_details: { metadata: { workspaceId: '00000000-0000-4000-8000-000000000001' } } } },
  }));
  assert.deepEqual(invoice, { invoiceId: 'in_123', workspaceId: '00000000-0000-4000-8000-000000000001', paidMicros: 59_000_000, currency: 'usd' });
});
