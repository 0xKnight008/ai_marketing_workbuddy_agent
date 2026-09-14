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
import { AdminEmailLogin, adminPrincipal } from '../src/admin/email-login';
import { AdminService } from '../src/admin/service';
import { createHash } from 'node:crypto';
import { ImportService } from '../src/import-service/service';
import { RunWorker } from '../src/run-service/worker-runner';
import { InsightFeedbackService } from '../src/insight-service/feedback';

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
    await t.test('admin links redeem atomically once, expire and revoke without workspace privileges', async () => {
      const email = 'admin@example.invalid';
      const config = { PLATFORM_ADMIN_EMAILS: email } as GatewayConfig;
      const login = new AdminEmailLogin(config, database);
      const ticket = 'a'.repeat(43);
      const hash = (value: string) => createHash('sha256').update(value).digest('hex');
      await client.query("INSERT INTO platform_admin_link(token_hash,email,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [hash(ticket), email]);
      const attempts = await Promise.allSettled([login.exchange({ ticket }), login.exchange({ ticket })]);
      assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
      const session = (attempts.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<string>).value;
      const actor = await login.authenticate(session);
      assert.equal(adminPrincipal(actor)?.email, email);
      assert.deepEqual(await new AdminService(config, database).newsletter(actor, undefined, {}), []);
      await client.query("INSERT INTO feedback_message(ticket_no,email,message) VALUES('FB-AAAAAAAA','sender@example.invalid','admin audit test')");
      await new AdminService(config, database).updateFeedback(actor, undefined, 'FB-AAAAAAAA', { status: 'closed' });
      const audit = await client.query("SELECT email,workspace_id FROM platform_admin_audit WHERE event_type='admin.feedback_status_changed'");
      assert.deepEqual(audit.rows, [{ email, workspace_id: null }]);
      await assert.rejects(new AdminService(config, database).newsletter({ ...actor }, undefined, {}), /platform_admin_required/);
      await assert.rejects(new AdminEmailLogin({ PLATFORM_ADMIN_EMAILS: '' } as GatewayConfig, database).authenticate(session), /admin_session_required/);
      await login.logout(session);
      await assert.rejects(login.authenticate(session), /admin_session_required/);
      await client.query("UPDATE platform_admin_link SET consumed_at=NULL, expires_at=now()-interval '1 second' WHERE token_hash=$1", [hash(ticket)]);
      await assert.rejects(login.exchange({ ticket }), /admin_link_invalid_or_expired/);
      await client.query("UPDATE platform_admin_session SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE token_hash=$1", [hash(session)]);
      await assert.rejects(login.authenticate(session), /admin_session_required/);
    });
    const registration = await auth.register(credentials, 'test-client');
    const registered = verifyAccessToken(registration.accessToken, secret);
    await t.test('real import service persists UUID batches, crosses chunk boundaries, and rolls back atomically', async () => {
      const owner = verifyAccessToken((await auth.register({ email: 'imports@example.invalid', password: 'test-only-password' }, 'import-test')).accessToken, secret);
      // Registration creates identity/workspace only, not a billing row.
      // Seed an explicit subscription fixture; an UPDATE alone silently affects zero rows.
      await database.withWorkspace(owner.workspaceId, async tx => {
        const seeded = await tx.query(`INSERT INTO workspace_billing (workspace_id, subscription_status, trial_ends_at)
          VALUES (current_setting('app.workspace_id')::uuid, 'trialing', now()+interval '7 days')
          ON CONFLICT (workspace_id) DO UPDATE SET subscription_status=EXCLUDED.subscription_status, trial_ends_at=EXCLUDED.trial_ends_at
          RETURNING workspace_id`);
        assert.equal(seeded.rowCount, 1);
        const usage = await usageSnapshot(tx);
        assert.equal(usage.subscriptionStatus, 'trialing');
        assert.equal(usage.aiCreditsAvailable, 30);
        assert.equal(usage.status, 'normal');
      });
      const imports = new ImportService(database);
      const single = await imports.createImport(owner, { label: 'Single', sourceType: 'paste', content: 'hello' });
      assert.equal(single.itemCount, 1);
      const batch = await imports.createImport(owner, { label: '500 comments', sourceType: 'csv', content: 'text,author\n' + Array.from({ length: 500 }, (_, i) => `comment ${i},reader ${i}`).join('\n') });
      assert.equal(batch.itemCount, 500);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM import_item WHERE batch_id=$1', [batch.id])).rows[0].n, 500);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM job WHERE kind='import.classify' AND payload->>'batchId'=$1", [batch.id])).rows[0].n, 1);
      // Real database + deterministic model fixture: partial response commits
      // no progress, retries the full paid chunk, then completes all 500 items.
      let modelCalls = 0;
      const worker = new RunWorker({
        workerName: 'import-integrity-regression',
        database: {
          withWorkspace: database.withWorkspace.bind(database),
          claimNextJob: async () => {
            const job = await client.query(`UPDATE job SET status='running', attempt=attempt+1
              WHERE kind='import.classify' AND payload->>'batchId'=$1 AND status='queued'
              RETURNING id, attempt`, [batch.id]);
            return job.rows[0] && { ...job.rows[0], workspaceId: owner.workspaceId, runId: null, kind: 'import.classify', payload: { batchId: batch.id } };
          },
        },
        aiRuntime: {
          async prepareAnnouncement() { throw new Error('unexpected'); },
          async getAnnouncementRun() { throw new Error('unexpected'); },
          async generateInsightReport() { throw new Error('unexpected'); },
          async classifyItems(payload) {
            modelCalls += 1;
            const items = payload.items as Array<{ index: number; text: string }>;
            return { assignments: (modelCalls === 1 ? items.slice(1) : items).map(item => ({ itemIndex: item.index, sentiment: { label: 'neutral', confidence: 0.9, evidence: item.text }, tags: [
              { tag: 'content_idea', confidence: 1, evidence: item.text },
              { tag: 'suggestion', confidence: 1, evidence: item.text },
            ] })) };
          },
        },
      });
      await worker.runOne();
      assert.equal((await client.query('SELECT count(*)::int AS n FROM import_item WHERE batch_id=$1 AND classified_at IS NOT NULL', [batch.id])).rows[0].n, 0);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM import_item WHERE batch_id=$1 AND sentiment IS NOT NULL', [batch.id])).rows[0].n, 0);
      await worker.runOne();
      assert.equal(modelCalls, 11, 'one incomplete call, then ten complete chunks');
      assert.equal((await client.query("SELECT count(*)::int AS n FROM import_item WHERE batch_id=$1 AND sentiment->>'label'='neutral' AND sentiment->>'evidence'=text", [batch.id])).rows[0].n, 500);
      assert.equal((await client.query('SELECT status FROM import_batch WHERE id=$1', [batch.id])).rows[0].status, 'classified');
      assert.equal((await client.query('SELECT count(*)::int AS n FROM import_item WHERE batch_id=$1 AND classified_at IS NOT NULL', [batch.id])).rows[0].n, 500);
      const charges = await client.query('SELECT count(*)::int AS n, sum(ai_credits)::int AS credits FROM task_event WHERE subject_id=$1', [batch.id]);
      assert.deepEqual(charges.rows[0], { n: 10, credits: 10 });
      const coverage = await client.query("SELECT payload FROM audit_event WHERE event_type='import.classified' AND payload->>'batchId'=$1", [batch.id]);
      assert.equal(coverage.rows[0].payload.items, 500);
      assert.equal(coverage.rows[0].payload.tagCoverageRate, 1, 'two tags per item must not inflate the denominator');
      const before = (await client.query('SELECT count(*)::int AS n FROM import_batch')).rows[0].n;
      await client.query("ALTER TABLE import_item ADD CONSTRAINT import_test_failure CHECK (text <> 'force transaction rollback')");
      try {
        await assert.rejects(imports.createImport(owner, { label: 'Rollback', sourceType: 'paste', content: [...Array(200).fill('valid'), 'force transaction rollback'].join('\n') }), { code: '23514' });
      } finally { await client.query('ALTER TABLE import_item DROP CONSTRAINT import_test_failure'); }
      assert.equal((await client.query('SELECT count(*)::int AS n FROM import_batch')).rows[0].n, before);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM import_item WHERE text='valid'")).rows[0].n, 0);
    });
    await t.test('manual action feedback persists concurrent updates, deduplicates retries and isolates tenants', async () => {
      const feedbackOwner = verifyAccessToken((await auth.register({ email: 'feedback-regression@example.invalid', password: 'test-only-password' }, 'feedback-test')).accessToken, secret);
      const feedbackService = new InsightFeedbackService(database);
      const reportResult = await client.query(`INSERT INTO insight_report (workspace_id, template, title, status, created_by, report)
        VALUES ($1, 'daily_ops', 'Feedback regression', 'generated', $2, $3::jsonb) RETURNING id`,
        [feedbackOwner.workspaceId, feedbackOwner.actorId, JSON.stringify({ tasks: [{ title: 'Reply to fans' }, { title: 'Prepare poll' }] })]);
      const reportId = reportResult.rows[0].id;
      assert.equal((await feedbackService.list(feedbackOwner, reportId)).actions[0]?.feedback, null);
      await Promise.all([
        feedbackService.save(feedbackOwner, reportId, 'tasks:0', { status: 'completed', effect: 'improved', note: 'Observed replies' }),
        feedbackService.save(feedbackOwner, reportId, 'tasks:1', { status: 'adopted' }),
      ]);
      await feedbackService.save(feedbackOwner, reportId, 'tasks:1', { status: 'adopted' });
      const feedbackActions = await feedbackService.list(feedbackOwner, reportId);
      assert.equal((feedbackActions.actions[0]?.feedback as { status: string }).status, 'completed');
      assert.equal((feedbackActions.actions[1]?.feedback as { status: string }).status, 'adopted');
      assert.equal((await client.query("SELECT count(*)::int AS n FROM audit_event WHERE event_type='insight.action_feedback' AND payload->>'reportId'=$1", [reportId])).rows[0].n, 2);
      await assert.rejects(feedbackService.list({ ...feedbackOwner, workspaceId: '11111111-1111-4111-8111-111111111111' }, reportId), { statusCode: 404 });
      await assert.rejects(feedbackService.save({ ...feedbackOwner, role: 'viewer' }, reportId, 'tasks:0', { status: 'dismissed' }), { statusCode: 403 });
    });
    await t.test('unlinked historical trial recovers by verified subscription ID with exactly thirty credits', async recovery => {
      const owner = verifyAccessToken((await auth.register({ email: 'trial-recovery@example.invalid', password: 'test-only-password' }, 'recovery-test')).accessToken, secret);
      const end = Math.floor(Date.now()/1000) + 86400;
      recovery.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'sub_recovery', customer: 'cus_recovery', status: 'trialing', trial_end: end,
        metadata: { workspaceId: owner.workspaceId }, items: { data: [{ price: { id: 'price_recovery' } }] } }));
      const service = new PlatformService({ STRIPE_SECRET_KEY: 'test', STRIPE_PRICE_CREATOR: 'price_recovery' } as GatewayConfig, database, {} as PlatformOrm);
      for (let i=0;i<2;i++) {
        const usage = await service.recoverStripeSubscription(owner, { subscriptionId: 'sub_recovery' }) as UsageSnapshot;
        assert.equal(usage.aiCreditsAvailable, 30); assert.equal(usage.status, 'normal'); assert.equal(Date.parse(usage.trialEndsAt!), end*1000);
      }
      await assert.rejects(service.recoverStripeSubscription(registered, { subscriptionId: 'sub_recovery' }), /stripe_workspace_mismatch/);
    });
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
        // Replaying an already-paid operation is different from buying a new
        // operation. Assert both sides of the empty-balance contract.
        const replay = await reserveAiRun(tx, ['eco'], run.rows[0]!.id);
        assert.equal(replay.replayed, true);
        assert.equal(replay.charged, false);
        const unpaid = await reserveAiRun(tx, ['eco'], { runId: run.rows[0]!.id, attempt: 2 });
        assert.equal(unpaid.replayed, false);
        assert.equal(unpaid.charged, false);
        assert.equal(unpaid.guardrail.status, 'paused');
        assert.equal((await usageSnapshot(tx)).aiCreditsAvailable, 0);
        await applyCreditTopup(tx, { sessionId: 'cs_topup_pg2', paymentIntentId: 'pi_topup_pg2', amountCents: 1000 });
        assert.equal((await usageSnapshot(tx)).aiCreditsAvailable, 999, 'spent refund debt is settled before new credits are available');
      });
    });
  } finally { await Promise.all([database.close(), client.end()]); }
});
