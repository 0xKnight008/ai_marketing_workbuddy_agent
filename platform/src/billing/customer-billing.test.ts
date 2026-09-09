import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomerBillingService, creditsForPayment, applyCreditTopup, applyCreditRefund } from './customer-billing';
import { gatewayConfigSchema } from '../foundation/platform-config';
import type { Database, TenantTransaction } from '../foundation/database';
import type { ActorContext } from '../contracts/domain';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const actor = { workspaceId, actorId: '00000000-0000-4000-8000-000000000002', role: 'owner' } as ActorContext;
const config = gatewayConfigSchema.parse({ DATABASE_URL: 'postgres://localhost/test', AUTH_TOKEN_SECRET: 'x'.repeat(32), AI_RUNTIME_EVENT_SIGNING_SECRET: 'x'.repeat(32), STRIPE_SECRET_KEY: 'test-only', STRIPE_PRICE_AI_CREDITS: 'price_topup', STRIPE_PRICE_CREATOR: 'price_creator' });
function fixture() {
  let balance = 0;
  let debt = 0;
  let refunded = 0;
  let inserted = false;
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes('INSERT INTO workspace_billing')) return { rows: [{ plan: 'creator', purchasedCredits: String(balance), subscriptionStatus: 'active', trialEndsAt: null }], rowCount: 1 };
    if (sql.includes('AS "aiCreditsUsed"')) return { rows: [{ aiCreditsUsed: 0, taskUsed: 0, supplierSpendMicros: 0 }], rowCount: 1 };
    if (sql.includes('AS "connectedAccounts"')) return { rows: [{ connectedAccounts: 0 }], rowCount: 1 };
    if (sql.includes('AS "customerId"')) return { rows: [{ customerId: 'cus_owner', subscriptionId: null, balance: String(balance), debt: String(debt) }], rowCount: 1 };
    if (sql.includes('INSERT INTO credit_topup')) { if (inserted) return { rows: [], rowCount: 0 }; inserted = true; return { rows: [{}], rowCount: 1 }; }
    if (sql.includes('purchased_ai_credits = purchased_ai_credits +')) { const amount = Number(values[0]); balance += Math.max(0, amount - debt); debt = Math.max(0, debt - amount); }
    if (sql.includes('SELECT refunded_cents')) return { rows: inserted ? [{ refunded, amount: 1000 }] : [], rowCount: inserted ? 1 : 0 };
    if (sql.includes('credit_refund_debt = credit_refund_debt +')) { const delta = Number(values[0]); debt += Math.max(0, delta - balance); balance = Math.max(0, balance - delta); }
    if (sql.includes('UPDATE credit_topup')) refunded += Number(values[1]);
    return { rows: [], rowCount: 1 };
  };
  const tx = { query } as TenantTransaction;
  const db = { withWorkspace: async (id: string, fn: (tx: TenantTransaction) => unknown) => { assert.equal(id, workspaceId); return fn(tx); } } as Database;
  return { service: new CustomerBillingService(config, db), tx, state: () => ({ balance, debt, refunded }), spend: (amount: number) => { balance -= amount; } };
}
const session = { id: 'cs_test', mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', customer: 'cus_owner', payment_intent: 'pi_test', amount_total: 1000, amount_subtotal: 1000,
  metadata: { workspaceId, purpose: 'ai_credit_topup' }, line_items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_topup' } }] } };

test('integer USD cents convert to credits only within the agreed range', () => {
  assert.equal(creditsForPayment(1000), 1000); assert.equal(creditsForPayment(100000), 100000);
  for (const amount of [0, 999, 100001, 1000.5, NaN, Infinity]) assert.throws(() => creditsForPayment(amount));
});
test('a paid checkout credits once across return and webhook delivery', async (t) => {
  const f = fixture(); t.mock.method(globalThis, 'fetch', async () => Response.json(session));
  assert.deepEqual(await f.service.confirmTopup(actor, { sessionId: 'cs_test' }), { credited: true });
  assert.equal(await f.service.webhook(JSON.stringify({ type: 'checkout.session.completed', data: { object: session } })), true);
  assert.equal(f.state().balance, 1000);
});
test('unpaid, other-customer, other-workspace and wrong-price checkout never credits', async (t) => {
  for (const change of [{ payment_status: 'unpaid' }, { customer: 'cus_other' }, { metadata: { ...session.metadata, workspaceId: '00000000-0000-4000-8000-000000000003' } }, { amount_total: 1001 }, { line_items: { ...session.line_items, data: [{ quantity: 1, price: { id: 'price_other' } }] } }]) {
    const f = fixture(); const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ...session, ...change }));
    await assert.rejects(f.service.confirmTopup(actor, { sessionId: 'cs_test' })); assert.equal(f.state().balance, 0); mock.mock.restore();
  }
});
test('billing mutations require the owner before contacting Stripe', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not call'); });
  const service = fixture().service; const viewer = { ...actor, role: 'viewer' as const };
  await assert.rejects(service.startTopup(viewer), /owner_required/);
  await assert.rejects(service.portal(viewer), /owner_required/);
  await assert.rejects(service.confirmTopup(viewer, {}), /owner_required/);
  assert.equal(mock.mock.callCount(), 0);
});
test('top-up creates a bound one-time checkout with the configured amount limits', async (t) => {
  const requests: URLSearchParams[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    if (!options?.body) return Response.json({ active: true, type: 'one_time', currency: 'usd', custom_unit_amount: { minimum: 1000, maximum: 100000 } });
    requests.push(options.body as URLSearchParams); return Response.json({ url: 'https://checkout.stripe.com/c/pay/test' });
  });
  await fixture().service.startTopup(actor);
  assert.equal(requests[0]!.get('mode'), 'payment'); assert.equal(requests[0]!.get('customer'), 'cus_owner');
  assert.equal(requests[0]!.get('line_items[0][price]'), 'price_topup'); assert.equal(requests[0]!.get('metadata[workspaceId]'), workspaceId);
});
test('misconfigured price stops checkout creation', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ active: true, type: 'recurring', currency: 'usd' }));
  await assert.rejects(fixture().service.startTopup(actor), /credit_topup_price_invalid/); assert.equal(mock.mock.callCount(), 1);
});
test('refunds are cumulative, idempotent and carry spent credits as debt', async () => {
  const f = fixture(); await applyCreditTopup(f.tx, { sessionId: 'cs_test', paymentIntentId: 'pi_test', amountCents: 1000 }); f.spend(900);
  await applyCreditRefund(f.tx, 'pi_test', 500); await applyCreditRefund(f.tx, 'pi_test', 500); await applyCreditRefund(f.tx, 'pi_test', 200);
  assert.deepEqual(f.state(), { balance: 0, debt: 400, refunded: 500 });
  await applyCreditRefund(f.tx, 'pi_test', 1000); assert.deepEqual(f.state(), { balance: 0, debt: 900, refunded: 1000 });
});
test('refund arriving before fulfillment requests a retry', async () => {
  await assert.rejects(applyCreditRefund(fixture().tx, 'pi_test', 1000), /topup_refund_waiting_for_payment/);
});
