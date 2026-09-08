import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmCheckout } from '../src/lib/checkout-confirmation';

test('a success URL alone never grants entitlement', async () => {
  await assert.rejects(confirmCheckout('', null, 'token'), /checkout_session_missing/);
  assert.equal(await confirmCheckout('', 'cs_test_valid', ''), 'signin');
  await assert.rejects(confirmCheckout('', 'cs_test_valid', 'token', async () => Response.json({}, { status: 403 })), /checkout_confirmation_failed/);
});
test('trialing without a charge is confirmed only with an unexpired server trial', async () => {
  const result = await confirmCheckout('', 'cs_test_valid', 'token', async (url, options) => {
    assert.equal(url, '/api/billing/checkout-session/confirm');
    assert.deepEqual(JSON.parse(String(options?.body)), { sessionId: 'cs_test_valid' });
    return Response.json({ subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 60_000).toISOString() });
  });
  assert.equal(result, 'confirmed');
  for (const subscriptionStatus of ['inactive', 'trialing', 'canceled']) await assert.rejects(confirmCheckout('', 'cs_test_valid', 'token', async () => Response.json({ subscriptionStatus })), /checkout_not_entitled/);
});
test('expired login returns to sign-in, while pending verification is an error rather than success', async () => {
  assert.equal(await confirmCheckout('', 'cs_test_valid', 'token', async () => Response.json({}, { status: 401 })), 'signin');
  await assert.rejects(confirmCheckout('', 'cs_test_valid', 'token', async () => Response.json({}, { status: 409 })), /checkout_confirmation_failed/);
});
