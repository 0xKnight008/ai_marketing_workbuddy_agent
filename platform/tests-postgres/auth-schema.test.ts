import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { Client } from 'pg';

import { assertAuthSchema } from '../src/foundation/auth-readiness';
import { Database } from '../src/foundation/database';
import type { GatewayConfig } from '../src/foundation/platform-config';
import { EmailAuthService } from '../src/identity/email-auth';
import { verifyAccessToken } from '../src/identity/token';
import { PlatformService } from '../src/egg/platform-service';
import type { PlatformOrm } from '../src/foundation/sequelize';
import { requireAutomationAccess, reserveAiRun, usageSnapshot, type UsageSnapshot } from '../src/billing/guardrails';
import { applyCreditTopup, applyCreditRefund } from '../src/billing/customer-billing';

test('migration 0013 upgrades missing auth columns and enables register/login/me on PostgreSQL', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'TEST_DATABASE_URL must point to an empty disposable database; never use production');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  const database = new Database(url);
  await client.connect();
  try {
    const existing = await client.query("SELECT to_regclass('public.app_user') AS users");
    assert.equal(existing.rows[0].users, null, 'Refusing to run against an existing platform database');
    const directory = path.resolve('migrations');
    const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    // This is an explicitly disposable CI database. Commit each migration so
    // the application's actual connection pool can exercise the installed SQL.
    const migrate = async (name: string) => {
      await client.query('BEGIN');
      try {
        await client.query(await readFile(path.join(directory, name), 'utf8'));
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    };
    for (const name of names.filter((name) => name < '0013')) await migrate(name);

    await assert.rejects(assertAuthSchema(database), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error.cause as { code: string }).code, '42703');
      return true;
    });
    const secret = 'auth-schema-regression-secret-longer-than-32-bytes';
    const auth = new EmailAuthService({ AUTH_TOKEN_SECRET: secret, AUTH_SESSION_TTL_SECONDS: 3_600 } as GatewayConfig, database);
    const credentials = { email: 'schema-regression@example.invalid', password: 'test-only-password' };
    await assert.rejects(auth.login(credentials, 'test-client'), { code: '42703' });
    await assert.rejects(auth.register(credentials, 'test-client'), { code: '42703' });

    for (const name of names.filter((name) => name >= '0013')) await migrate(name);
    await assertAuthSchema(database);
    const registration = await auth.register(credentials, 'test-client');
    const registered = verifyAccessToken(registration.accessToken, secret);
    assert.equal((await auth.me(registered)).user.passwordSet, true);
    assert.equal((await auth.me(registered)).subscriptionStatus, 'inactive');
    const session = await auth.login(credentials, 'test-client');
    assert.equal(verifyAccessToken(session.accessToken, secret).actorId, registered.actorId);
    await assert.rejects(auth.login({ ...credentials, password: 'wrong-password' }, 'test-client'), /invalid_credentials/);
    await assert.rejects(auth.register(credentials, 'test-client'), /email_already_registered/);
    await t.test('completed free-trial checkout unlocks the real workspace without waiting for a webhook or charge', async (trial) => {
      const trialEnd = Math.floor(Date.now() / 1000) + 7 * 86_400;
      trial.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.includes('/checkout/') ? {
        id: 'cs_test_trial', status: 'complete', mode: 'subscription', payment_status: 'no_payment_required',
        customer: 'cus_test_trial', subscription: 'sub_test_trial',
        metadata: { workspaceId: registered.workspaceId, actorId: registered.actorId, plan: 'growth' },
      } : { id: 'sub_test_trial', customer: 'cus_test_trial', status: 'trialing', trial_end: trialEnd,
        metadata: { workspaceId: registered.workspaceId }, items: { data: [{ price: { id: 'price_test' } }] } }));
      const service = new PlatformService({ STRIPE_SECRET_KEY: 'test-only' } as GatewayConfig, database, {} as PlatformOrm);
      for (let attempt = 0; attempt < 2; attempt++) {
        const usage = await service.reconcileStripeCheckout(registered, { sessionId: 'cs_test_trial' }) as UsageSnapshot;
        assert.equal(usage.subscriptionStatus, 'trialing');
        assert.equal(usage.status, 'normal');
        assert.equal(Date.parse(usage.trialEndsAt!), trialEnd * 1000);
      }
      assert.equal((await auth.me(registered)).subscriptionStatus, 'trialing');
      await database.withWorkspace(registered.workspaceId, requireAutomationAccess);
      const recorded = await client.query("SELECT count(*)::int AS count FROM billing_webhook_event WHERE external_event_id = 'checkout-return:cs_test_trial'");
      assert.equal(recorded.rows[0].count, 1);
      await database.withWorkspace(registered.workspaceId, async (tx) => {
        const workflow = await tx.query<{ id: string }>('INSERT INTO workflow (workspace_id, name, created_by) VALUES ($1, $2, $3) RETURNING id', [registered.workspaceId, 'Trial cap regression', registered.actorId]);
        const workflowId = workflow.rows[0]!.id;
        await tx.query("INSERT INTO workflow_version (workflow_id, version, definition, created_by) VALUES ($1, 1, '{}', $2)", [workflowId, registered.actorId]);
        const run = await tx.query<{ id: string }>(`INSERT INTO workflow_run (workspace_id, workflow_id, workflow_version, idempotency_key, input, context_snapshot, requested_by)
          VALUES ($1, $2, 1, 'trial-cap', '{}', '{}', $3) RETURNING id`, [registered.workspaceId, workflowId, registered.actorId]);
        await tx.query(`INSERT INTO task_event (workspace_id, run_id, action_type, billable_units, ai_credits, status)
          VALUES ($1, $2, 'ai.eco.primary', 0, 30, 'succeeded')`, [registered.workspaceId, run.rows[0]!.id]);
        await tx.query('UPDATE workspace_billing SET purchased_ai_credits = 1000 WHERE workspace_id = $1', [registered.workspaceId]);
      });
      await assert.rejects(database.withWorkspace(registered.workspaceId, requireAutomationAccess), /automation_paused/);
      await client.query('UPDATE workspace_billing SET stripe_subscription_id = $1 WHERE workspace_id = $2', ['sub_newer', registered.workspaceId]);
      await assert.rejects(service.reconcileStripeCheckout(registered, { sessionId: 'cs_test_trial' }), /stripe_subscription_mismatch/);
    });
    await t.test('credit wallet survives rollover, consumes once and reconciles cumulative refunds', async () => {
      await database.withWorkspace(registered.workspaceId, async (tx) => {
        await tx.query(`UPDATE workspace_billing SET plan = 'creator', subscription_status = 'active', purchased_ai_credits = 0,
          period_start = date_trunc('month', now()) - interval '1 month' WHERE workspace_id = $1`, [registered.workspaceId]);
        const input = { sessionId: 'cs_topup_pg', paymentIntentId: 'pi_topup_pg', amountCents: 1000 };
        assert.equal(await applyCreditTopup(tx, input), true);
        assert.equal(await applyCreditTopup(tx, input), false);
        // The earlier trial fixture used 30 credits; complete the 400 included credits.
        const existing = await tx.query<{ workflow_id: string }>('SELECT workflow_id FROM workflow_run WHERE workspace_id = $1 LIMIT 1', [registered.workspaceId]);
        const run = await tx.query<{ id: string }>(`INSERT INTO workflow_run (workspace_id, workflow_id, workflow_version, idempotency_key, input, context_snapshot, requested_by)
          VALUES ($1, $2, 1, 'credit-wallet', '{}', '{}', $3) RETURNING id`, [registered.workspaceId, existing.rows[0]!.workflow_id, registered.actorId]);
        await tx.query(`INSERT INTO task_event (workspace_id, run_id, action_type, billable_units, ai_credits, status)
          VALUES ($1, $2, 'test.included', 0, 370, 'succeeded')`, [registered.workspaceId, run.rows[0]!.id]);
        assert.equal((await usageSnapshot(tx)).aiCreditsAvailable, 1000);
        await reserveAiRun(tx, ['eco'], run.rows[0]!.id);
        await reserveAiRun(tx, ['eco'], run.rows[0]!.id);
        assert.equal((await usageSnapshot(tx)).aiCreditsAvailable, 999);
        await applyCreditRefund(tx, 'pi_topup_pg', 500);
        await applyCreditRefund(tx, 'pi_topup_pg', 500);
        await applyCreditRefund(tx, 'pi_topup_pg', 200);
        assert.equal((await usageSnapshot(tx)).aiCreditsAvailable, 499);
        await applyCreditRefund(tx, 'pi_topup_pg', 1000);
        assert.equal((await usageSnapshot(tx)).aiCreditsAvailable, 0);
        assert.equal((await reserveAiRun(tx, ['eco'], run.rows[0]!.id)).guardrail.status, 'paused');
        await applyCreditTopup(tx, { sessionId: 'cs_topup_pg2', paymentIntentId: 'pi_topup_pg2', amountCents: 1000 });
        assert.equal((await usageSnapshot(tx)).aiCreditsAvailable, 999, 'spent refund debt is settled before new credits are available');
      });
    });
  } finally { await Promise.all([database.close(), client.end()]); }
});
