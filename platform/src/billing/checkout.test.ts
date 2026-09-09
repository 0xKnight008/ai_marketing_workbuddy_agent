import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayConfig } from '../foundation/platform-config';
import type { Database } from '../foundation/database';
import type { PlatformOrm } from '../foundation/sequelize';
import { PlatformService } from '../egg/platform-service';
import { createStripeCheckoutSession } from './stripe';
import { PLAN_KEYS } from './plans';

const config = {
  STRIPE_SECRET_KEY: 'sk_test_fake', PUBLIC_SITE_URL: 'https://www.piggybot.me', STRIPE_TRIAL_DAYS: 7,
  STRIPE_PRICE_CREATOR: 'price_creator_month', STRIPE_PRICE_GROWTH: 'price_growth_month', STRIPE_PRICE_AGENCY: 'price_agency_month',
  STRIPE_PRICE_CREATOR_YEARLY: 'price_creator_year', STRIPE_PRICE_GROWTH_YEARLY: 'price_growth_year', STRIPE_PRICE_AGENCY_YEARLY: 'price_agency_year',
} as GatewayConfig;
const identity = { workspaceId: '00000000-0000-4000-8000-000000000001', actorId: '00000000-0000-4000-8000-000000000002' };

for (const plan of PLAN_KEYS) {
  for (const billingInterval of ['month', 'year'] as const) {
    test(`${plan} ${billingInterval} selects its server-configured Price and preserves checkout context`, async (t) => {
      const requests: { url: string; body?: URLSearchParams }[] = [];
      t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
        requests.push({ url: String(url), body: options?.body as URLSearchParams });
        if (String(url).includes('/prices/')) return Response.json({ active: true, recurring: { interval: 'year', interval_count: 1 } });
        return Response.json({ id: 'cs_fake', url: 'https://checkout.stripe.com/test' });
      });
      const session = await createStripeCheckoutSession(config, { ...identity, plan, billingInterval, referralCode: 'ABCDEFGH' });
      assert.equal(session.id, 'cs_fake');
      assert.equal(requests.length, billingInterval === 'year' ? 2 : 1);
      const body = requests.at(-1)!.body!;
      assert.equal(body.get('line_items[0][price]'), `price_${plan}_${billingInterval}`);
      assert.equal(body.get('metadata[billingInterval]'), billingInterval);
      assert.equal(body.get('subscription_data[metadata][billingInterval]'), billingInterval);
      assert.equal(body.get('subscription_data[metadata][plan]'), plan);
      assert.equal(body.get('subscription_data[trial_period_days]'), '7');
      for (const key of ['success_url', 'cancel_url']) {
        const url = new URL(body.get(key)!);
        assert.equal(url.searchParams.get('plan'), plan);
        assert.equal(url.searchParams.get('billingInterval'), billingInterval);
        assert.equal(url.searchParams.get('ref'), 'ABCDEFGH');
      }
      assert.ok(body.get('success_url')!.endsWith('session_id={CHECKOUT_SESSION_ID}'));
    });
  }
}

test('old callers still default to month; yearly never falls back to monthly Price', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, options?: RequestInit) => {
    requests++;
    assert.equal((options!.body as URLSearchParams).get('line_items[0][price]'), 'price_growth_month');
    return Response.json({ id: 'cs_fake', url: 'https://checkout.stripe.com/test' });
  });
  await createStripeCheckoutSession(config, { ...identity, plan: 'growth' });
  await assert.rejects(createStripeCheckoutSession({ ...config, STRIPE_PRICE_GROWTH_YEARLY: undefined }, { ...identity, plan: 'growth', billingInterval: 'year' }), /stripe_not_configured/);
  assert.equal(requests, 1);
});

for (const price of [
  { active: true, recurring: { interval: 'month', interval_count: 1 } },
  { active: true, recurring: { interval: 'year', interval_count: 2 } },
  { active: false, recurring: { interval: 'year', interval_count: 1 } },
  { active: true, recurring: null },
]) {
  test(`rejects invalid annual configuration ${JSON.stringify(price)}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      assert.ok(String(url).includes('/prices/'), 'must not create Checkout');
      return Response.json(price);
    });
    await assert.rejects(createStripeCheckoutSession(config, { ...identity, plan: 'growth', billingInterval: 'year' }), /stripe_annual_price_invalid/);
  });
}

test('unknown/unavailable annual Price stops before Checkout creation', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.ok(String(url).includes('/prices/'));
    return Response.json({ error: 'not found' }, { status: 404 });
  });
  await assert.rejects(createStripeCheckoutSession(config, { ...identity, plan: 'growth', billingInterval: 'year' }), /stripe_price_lookup_failed/);
});

test('gateway validates interval and owner before external calls; ignores client-supplied Price IDs', async (t) => {
  const audit: unknown[][] = [];
  const database = { withWorkspace: async (_id: string, op: (tx: unknown) => Promise<unknown>) => op({ query: async (sql: string, values: unknown[]) => { if (sql.includes('INSERT INTO audit_event')) audit.push(values); return { rows: [], rowCount: 1 }; } }) } as unknown as Database;
  const service = new PlatformService(config, database, {} as PlatformOrm);
  const actor = { ...identity, role: 'owner' as const };
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    requests++;
    if (String(url).includes('/prices/')) return Response.json({ active: true, recurring: { interval: 'year', interval_count: 1 } });
    assert.equal((options!.body as URLSearchParams).get('line_items[0][price]'), 'price_growth_year');
    return Response.json({ id: 'cs_fake', url: 'https://checkout.stripe.com/test' });
  });
  await assert.rejects(service.createStripeCheckout(actor, { plan: 'growth', billingInterval: 'week' }));
  await assert.rejects(service.createStripeCheckout({ ...actor, role: 'viewer' }, { plan: 'growth', billingInterval: 'year' }), /owner_required/);
  assert.equal(requests, 0);
  await service.createStripeCheckout(actor, { plan: 'growth', billingInterval: 'year', priceId: 'price_attacker' });
  assert.equal(requests, 2);
  assert.deepEqual(audit[0]![3], { plan: 'growth', billingInterval: 'year', stripeCheckoutSessionId: 'cs_fake' });
});
