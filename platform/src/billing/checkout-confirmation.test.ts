import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectRecordedCheckout, retrieveCheckoutActivation } from './stripe';
import type { GatewayConfig } from '../foundation/platform-config';
import type { ActorContext } from '../contracts/domain';

const actor: ActorContext = { actorId: '10000000-0000-4000-8000-000000000001', workspaceId: '20000000-0000-4000-8000-000000000001', role: 'owner' };
const config = { STRIPE_SECRET_KEY: 'test-secret' } as GatewayConfig;
const session = { id: 'cs_test_valid', mode: 'subscription', status: 'complete', payment_status: 'no_payment_required', customer: 'cus_test', subscription: 'sub_test', metadata: { workspaceId: actor.workspaceId, actorId: actor.actorId, plan: 'growth' } };
const subscription = { id: 'sub_test', customer: 'cus_test', status: 'trialing', trial_end: Math.floor(Date.now() / 1000) + 86_400, metadata: { workspaceId: actor.workspaceId }, items: { data: [{ price: { id: 'price_test' } }] } };

test('server verifies trial completion and preserves the Stripe trial expiry', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.includes('/checkout/') ? session : subscription));
  const result = await retrieveCheckoutActivation(config, session.id, actor);
  assert.equal(result.subscriptionStatus, 'trialing');
  assert.equal(result.trialEndsAt, new Date(subscription.trial_end * 1000).toISOString());
  assert.equal(result.eventId, `checkout-return:${session.id}`);
});

test('incomplete, cross-workspace and non-subscription sessions cannot grant access', async (t) => {
  let payload = { ...session };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(payload); });
  for (const change of [{ status: 'open' }, { payment_status: 'unpaid' }, { mode: 'payment' }, { metadata: { ...session.metadata, workspaceId: '30000000-0000-4000-8000-000000000001' } }]) {
    payload = { ...session, ...change };
    await assert.rejects(retrieveCheckoutActivation(config, session.id, actor));
  }
  assert.equal(calls, 4);
  await assert.rejects(retrieveCheckoutActivation(config, session.id, { ...actor, role: 'viewer' }), /owner_required/);
  assert.equal(calls, 4);
});

test('current Stripe state rejects canceled, expired and mismatched subscriptions', async (t) => {
  let payload = { ...subscription };
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.includes('/checkout/') ? session : payload));
  for (const change of [{ status: 'canceled' }, { trial_end: 1 }, { customer: 'cus_other' }, { metadata: { workspaceId: '30000000-0000-4000-8000-000000000001' } }]) {
    payload = { ...subscription, ...change };
    await assert.rejects(retrieveCheckoutActivation(config, session.id, actor));
  }
});

test('a customer-only open checkout is resumable, never treated as a subscription', async (t) => {
  let payload = { ...session, status: 'open', subscription: null, url: 'https://checkout.stripe.com/c/pay/cs_test_valid' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  assert.deepEqual(await inspectRecordedCheckout(config, session.id, actor), { state: 'open', url: payload.url });
  await assert.rejects(retrieveCheckoutActivation(config, session.id, actor), /stripe_checkout_not_complete/);
  payload = { ...payload, status: 'expired' };
  assert.deepEqual(await inspectRecordedCheckout(config, session.id, actor), { state: 'expired' });
  payload = { ...payload, status: 'complete' };
  await assert.rejects(retrieveCheckoutActivation(config, session.id, actor), /stripe_subscription_missing/);
});

test('recorded checkout recovery rejects another workspace and untrusted redirect URLs', async (t) => {
  let payload = { ...session, status: 'open', url: 'https://example.com/not-stripe' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  await assert.rejects(inspectRecordedCheckout(config, session.id, actor));
  payload = { ...payload, metadata: { ...session.metadata, workspaceId: '30000000-0000-4000-8000-000000000001' } };
  await assert.rejects(inspectRecordedCheckout(config, session.id, actor), /stripe_workspace_mismatch/);
});
