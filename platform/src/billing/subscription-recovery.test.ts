import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformService } from '../egg/platform-service';
import type { Database, TenantTransaction } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import type { PlatformOrm } from '../foundation/sequelize';
const actor = { actorId: '10000000-0000-4000-8000-000000000001', workspaceId: '20000000-0000-4000-8000-000000000001', role: 'owner' as const };
const subscription = { id: 'sub_test', customer: 'cus_test', status: 'trialing', trial_start: Math.floor(Date.now()/1000), trial_end: Math.floor(Date.now()/1000)+86400,
  metadata: { workspaceId: actor.workspaceId }, items: { data: [{ price: { id: 'price_creator' } }] } };
function fixture() {
  let activation: unknown[] | undefined;
  const database = { withWorkspace: async (_id: string, fn: (tx: TenantTransaction) => unknown) => fn({ query: async (sql: string, values: unknown[]) => {
    if (sql.includes('INSERT INTO workspace_billing')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: activation ? 'trialing' : 'inactive', trialEndsAt: activation?.[5] }], rowCount: 1 };
    if (sql.includes('INSERT INTO billing_webhook_event')) return { rows: activation ? [] : [{}], rowCount: activation ? 0 : 1 };
    if (sql.includes('UPDATE workspace_billing')) activation = values;
    return { rows: [], rowCount: 0 };
  } } as TenantTransaction) } as Database;
  return { service: new PlatformService({ STRIPE_SECRET_KEY: 'test', STRIPE_PRICE_CREATOR: 'price_creator' } as GatewayConfig, database, {} as PlatformOrm), activation: () => activation };
}
test('verified recovery grants exactly 30 trial credits without requiring a charge', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(subscription)); const f = fixture();
  for (let i=0;i<2;i++) {
    const usage = await f.service.recoverStripeSubscription(actor, { subscriptionId: 'sub_test' }) as { aiCreditsAvailable: number; status: string };
    assert.equal(usage.aiCreditsAvailable, 30); assert.equal(usage.status, 'normal');
  }
  assert.equal(f.activation()?.[6], new Date(subscription.trial_start*1000).toISOString());
});
test('untrusted workspace, expired or canceled subscriptions cannot be recovered', async t => {
  for (const change of [{ status: 'canceled' }, { trial_end: 1 }, { metadata: { workspaceId: 'other' } }]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ...subscription, ...change }));
    const f = fixture(); await assert.rejects(f.service.recoverStripeSubscription(actor, { subscriptionId: 'sub_test' })); assert.equal(f.activation(), undefined); mock.mock.restore();
  }
  await assert.rejects(fixture().service.recoverStripeSubscription({ ...actor, role: 'viewer' }, { subscriptionId: 'sub_test' }), /owner_required/);
});
