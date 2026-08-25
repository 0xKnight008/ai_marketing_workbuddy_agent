import { createHmac, timingSafeEqual } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { aiRuntimeEventSchema } from '../contracts/ai-runtime-event';
import { PLAN_KEYS } from '../billing/plans';
import { activateStripeSubscription, resumeBillingPausedRuns, updateEntitlement, updateStripeSubscriptionStatus, usageSnapshot } from '../billing/guardrails';
import { createStripeCheckoutSession, retrieveStripeSubscription, stripeActivationFromWebhook, stripeSubscriptionStatusFromWebhook, verifyStripeWebhookSignature } from '../billing/stripe';
import type { ActorContext } from '../contracts/domain';
import { Database } from '../foundation/database';
import { loadGatewayConfig } from '../foundation/platform-config';
import { requirePermission } from '../foundation/rbac';
import { decryptSecret, encryptSecret } from '../foundation/secrets';
import { createPublishedTemplate } from '../gateway/templates';
import { verifyAccessToken } from '../identity/token';
import { createWorkflowRun } from '../gateway/run-request';
import { createDurableRun, decideApproval, ingestAiRuntimeEvent } from '../run-service/repository';
import { ZernioClient, type ZernioAccount } from '../zernio/client';
import { HttpError, publicError } from './errors';

async function main(): Promise<void> {

const config = loadGatewayConfig();

const database = new Database(config.DATABASE_URL);
const app = Fastify({ logger: true });
const rawBodies = new WeakMap<FastifyRequest, string>();

app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  const raw = body.toString('utf8');
  try {
    rawBodies.set(request, raw);
    done(null, JSON.parse(raw));
  } catch {
    done(new HttpError(400, 'invalid_json'));
  }
});

await app.register(cors, {
  origin: config.CORS_ORIGINS,
  credentials: true,
});

app.setErrorHandler((error, request, reply) => {
  const response = publicError(error);
  if (response.statusCode >= 500) request.log.error(error);
  return reply.code(response.statusCode).send(response.body);
});

function actorFrom(request: FastifyRequest): ActorContext {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'unauthorized');
  try {
    return verifyAccessToken(authorization.slice('Bearer '.length), config.AUTH_TOKEN_SECRET);
  } catch {
    throw new HttpError(401, 'unauthorized');
  }
}

function verifyAiRuntimeSignature(request: FastifyRequest): void {
  const raw = rawBodies.get(request);
  const received = request.headers['x-ai-runtime-signature'];
  if (!raw || typeof received !== 'string') throw new HttpError(401, 'unauthorized');
  const expected = createHmac('sha256', config.AI_RUNTIME_EVENT_SIGNING_SECRET).update(raw).digest('hex');
  const actualBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new HttpError(401, 'unauthorized');
  }
}

function zernioClient(): ZernioClient {
  if (!config.ZERNIO_BASE_URL || !config.ZERNIO_OAUTH_CLIENT_ID || !config.ZERNIO_OAUTH_REDIRECT_URI || !config.ZERNIO_OAUTH_STATE_SECRET) {
    throw new HttpError(503, 'provider_not_configured');
  }
  return new ZernioClient({
    baseUrl: config.ZERNIO_BASE_URL,
    oauthClientId: config.ZERNIO_OAUTH_CLIENT_ID,
    oauthRedirectUri: config.ZERNIO_OAUTH_REDIRECT_URI,
    oauthStateSecret: config.ZERNIO_OAUTH_STATE_SECRET,
    globalRequestsPerMinute: config.ZERNIO_CLIENT_RPM,
  });
}

async function storeZernioAccounts(workspaceId: string, credential: { accessToken: string; refreshToken?: string }, accounts: ZernioAccount[]): Promise<void> {
  if (!config.SECRET_ENCRYPTION_KEY_BASE64) throw new HttpError(503, 'provider_not_configured');
  const encrypted = encryptSecret(JSON.stringify(credential), config.SECRET_ENCRYPTION_KEY_BASE64);
  await database.withWorkspace(workspaceId, async (tx) => {
    const stored = await tx.query<{ id: string }>(
      `INSERT INTO secret (workspace_id, purpose, ciphertext, iv, auth_tag, rotated_at)
       VALUES ($1, 'zernio.oauth', $2, $3, $4, now())
       ON CONFLICT (workspace_id, purpose) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, rotated_at = now()
       RETURNING id`,
      [workspaceId, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
    );
    const secretId = stored.rows[0]?.id;
    if (!secretId) throw new Error('Zernio credential was not stored');
    for (const account of accounts) {
      await tx.query(
        `INSERT INTO connected_account (workspace_id, provider, external_account_id, display_name, secret_id, capabilities, status, last_synced_at)
         VALUES ($1, 'zernio', $2, $3, $4, $5, 'connected', now())
         ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE
           SET display_name = EXCLUDED.display_name, secret_id = EXCLUDED.secret_id, capabilities = EXCLUDED.capabilities,
               status = 'connected', last_synced_at = now()`,
        [workspaceId, account.externalId, account.displayName, secretId, account.capabilities],
      );
    }
  });
}

async function zernioCredential(workspaceId: string): Promise<{ accessToken: string; refreshToken?: string }> {
  if (!config.SECRET_ENCRYPTION_KEY_BASE64) throw new HttpError(503, 'provider_not_configured');
  const stored = await database.withWorkspace(workspaceId, (tx) => tx.query<{ ciphertext: string; iv: string; authTag: string }>(
    "SELECT ciphertext, iv, auth_tag AS \"authTag\" FROM secret WHERE workspace_id = $1 AND purpose = 'zernio.oauth'",
    [workspaceId],
  ));
  const value = stored.rows[0];
  if (!value) throw new HttpError(404, 'connection_not_found');
  const parsed = JSON.parse(decryptSecret(value, config.SECRET_ENCRYPTION_KEY_BASE64)) as { accessToken?: unknown; refreshToken?: unknown };
  if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) throw new Error('Stored Zernio credential is invalid');
  return { accessToken: parsed.accessToken, refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined };
}

app.get('/internal/health', async () => ({ ok: true, service: 'gateway' }));

app.post('/internal/ai-runtime-events', async (request, reply) => {
  verifyAiRuntimeSignature(request);
  const event = aiRuntimeEventSchema.parse(request.body);
  await database.withWorkspace(event.workspaceId, (tx) => ingestAiRuntimeEvent(tx, event));
  return reply.code(202).send({ accepted: true });
});

app.post('/api/workflow-runs', async (request, reply) => {
  const actor = actorFrom(request);
  const created = await createWorkflowRun(actor, request.body, {
    createRun: (context, runRequest) => database.withWorkspace(context.workspaceId, async (tx) => {
      const run = await createDurableRun(tx, context, runRequest);
      return { runId: run.id, status: 'pending' as const };
    }),
  });
  return reply.code(202).send(created);
});

app.post('/webhooks/stripe', async (request, reply) => {
  if (!config.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'stripe_not_configured');
  const raw = rawBodies.get(request);
  const signature = request.headers['stripe-signature'];
  if (!raw || typeof signature !== 'string') throw new HttpError(401, 'stripe_signature_missing');
  verifyStripeWebhookSignature(raw, signature, config.STRIPE_WEBHOOK_SECRET, config.STRIPE_WEBHOOK_TOLERANCE_SECONDS);
  const activation = stripeActivationFromWebhook(raw);
  if (activation) {
    const subscription = activation.subscriptionId ? await retrieveStripeSubscription(config, activation.subscriptionId) : undefined;
    if (subscription?.workspaceId && subscription.workspaceId !== activation.workspaceId) throw new HttpError(400, 'stripe_workspace_mismatch');
    const hydrated = {
      ...activation,
      customerId: subscription?.customerId ?? activation.customerId,
      subscriptionId: subscription?.id ?? activation.subscriptionId,
      priceId: subscription?.priceId ?? activation.priceId,
      subscriptionStatus: subscription?.status ?? activation.subscriptionStatus,
      trialEndsAt: subscription?.trialEndsAt,
    };
    const result = await database.withWorkspace(hydrated.workspaceId, async (tx) => {
      const applied = await activateStripeSubscription(tx, hydrated);
      if (applied.applied) {
        await tx.query('INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)', [hydrated.workspaceId, 'billing.stripe_activated', {
          plan: hydrated.plan,
          stripeEventId: hydrated.eventId,
          stripeSubscriptionId: hydrated.subscriptionId,
        }]);
      }
      return applied;
    });
    return reply.code(200).send({ received: true, activated: result.applied });
  }

  const statusEvent = stripeSubscriptionStatusFromWebhook(raw, config.STRIPE_PAYMENT_GRACE_DAYS);
  if (!statusEvent) return reply.code(202).send({ received: true, activated: false });
  const subscription = statusEvent.workspaceId ? undefined : await retrieveStripeSubscription(config, statusEvent.subscriptionId);
  const workspaceId = statusEvent.workspaceId ?? subscription?.workspaceId;
  if (!workspaceId) throw new HttpError(400, 'stripe_workspace_metadata_missing');
  const result = await database.withWorkspace(workspaceId, async (tx) => {
    const applied = await updateStripeSubscriptionStatus(tx, {
      ...statusEvent,
      customerId: subscription?.customerId ?? statusEvent.customerId,
      subscriptionId: subscription?.id ?? statusEvent.subscriptionId,
    });
    if (applied.applied) {
      await tx.query('INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)', [workspaceId, 'billing.stripe_subscription_status_changed', {
        eventType: statusEvent.eventType,
        stripeEventId: statusEvent.eventId,
        stripeSubscriptionId: statusEvent.subscriptionId,
        status: statusEvent.subscriptionStatus,
      }]);
    }
    return applied;
  });
  return reply.code(200).send({ received: true, activated: result.applied });
});

app.post('/api/workflow-templates/:templateId/publish', async (request, reply) => {
  const actor = actorFrom(request);
  const { templateId } = z.object({ templateId: z.enum(['repurpose', 'weekly_report', 'comment_lead']) }).parse(request.params);
  return reply.code(201).send(await database.withWorkspace(actor.workspaceId, (tx) => createPublishedTemplate(tx, actor, templateId)));
});

app.get('/api/zernio/connect', async (request) => {
  const actor = actorFrom(request);
  requirePermission(actor.role, 'connection:manage');
  return { url: zernioClient().connectUrl(actor.workspaceId) };
});

app.get('/api/zernio/callback', async (request, reply) => {
  const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
  const provider = zernioClient();
  const { workspaceId } = provider.verifyState(query.state);
  const token = await provider.exchangeCode(query.code);
  const accounts = await provider.listAccounts(token.accessToken);
  await storeZernioAccounts(workspaceId, token, accounts);
  return reply.code(200).type('text/html').send('<!doctype html><title>Piggybot</title><p>Zernio account connected. You may close this window.</p>');
});

app.post('/api/zernio/sync', async (request) => {
  const actor = actorFrom(request);
  requirePermission(actor.role, 'connection:manage');
  const credential = await zernioCredential(actor.workspaceId);
  const accounts = await zernioClient().listAccounts(credential.accessToken);
  await storeZernioAccounts(actor.workspaceId, credential, accounts);
  return { synced: accounts.length };
});

app.get('/api/approval-requests', async (request) => {
  const actor = actorFrom(request);
  requirePermission(actor.role, 'approval:decide');
  const rows = await database.withWorkspace(actor.workspaceId, (tx) => tx.query("SELECT id, run_id AS \"runId\", requested_action AS \"requestedAction\", requested_at AS \"requestedAt\" FROM approval_request WHERE workspace_id = $1 AND status = 'pending' ORDER BY requested_at LIMIT 100", [actor.workspaceId]));
  return rows.rows;
});

app.get('/api/runs/:runId', async (request, reply) => {
  const actor = actorFrom(request);
  requirePermission(actor.role, 'workflow:run');
  const params = z.object({ runId: z.string().uuid() }).parse(request.params);
  const run = await database.withWorkspace(actor.workspaceId, async (tx) => {
    const result = await tx.query<{ id: string; status: string; workflowId: string; createdAt: string }>(
      'SELECT id, status, workflow_id AS "workflowId", created_at::text AS "createdAt" FROM workflow_run WHERE id = $1 AND workspace_id = $2',
      [params.runId, actor.workspaceId],
    );
    return result.rows[0];
  });
  return run ? reply.send(run) : reply.code(404).send({ error: 'run_not_found' });
});

app.post('/api/approval-requests/:approvalId/:decision', async (request) => {
  const actor = actorFrom(request);
  requirePermission(actor.role, 'approval:decide');
  const params = z.object({ approvalId: z.string().uuid(), decision: z.enum(['approved', 'rejected']) }).parse(request.params);
  const body = z.object({ reason: z.string().max(1000).optional() }).parse(request.body ?? {});
  return database.withWorkspace(actor.workspaceId, (tx) => decideApproval(tx, actor, params.approvalId, params.decision, body.reason));
});

app.get('/api/billing/task-events', async (request) => {
  const actor = actorFrom(request);
  requirePermission(actor.role, 'billing:view');
  const events = await database.withWorkspace(actor.workspaceId, (tx) => tx.query('SELECT id, run_id AS "runId", action_type AS "actionType", billable_units AS "billableUnits", ai_credits AS "aiCredits", supplier_cost_micros AS "supplierCostMicros", status, created_at AS "createdAt" FROM task_event WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100', [actor.workspaceId]));
  return events.rows;
});

app.get('/api/billing/usage', async (request) => {
  const actor = actorFrom(request);
  requirePermission(actor.role, 'billing:view');
  return database.withWorkspace(actor.workspaceId, usageSnapshot);
});

app.post('/api/billing/checkout-session', async (request) => {
  const actor = actorFrom(request);
  if (actor.role !== 'owner') throw new HttpError(403, 'owner_required');
  const body = z.object({ plan: z.enum(PLAN_KEYS) }).parse(request.body);
  const checkout = await createStripeCheckoutSession(config, { workspaceId: actor.workspaceId, actorId: actor.actorId, plan: body.plan });
  await database.withWorkspace(actor.workspaceId, (tx) => tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)', [actor.workspaceId, actor.actorId, 'billing.stripe_checkout_started', { plan: body.plan, stripeCheckoutSessionId: checkout.id }]));
  return checkout;
});

// This endpoint is intended to be called by the verified payment webhook or
// an owner-only admin console. It never accepts payment details itself.
app.post('/api/billing/entitlements', async (request) => {
  if (!config.BILLING_ADMIN_TOKEN || request.headers['x-billing-admin-token'] !== config.BILLING_ADMIN_TOKEN) {
    throw new HttpError(403, 'billing_admin_required');
  }
  const actor = actorFrom(request);
  const body = z.object({
    plan: z.enum(PLAN_KEYS).optional(),
    additionalAiCredits: z.number().int().nonnegative().refine((value) => value % 1_000 === 0, 'additionalAiCredits must be a multiple of 1000').default(0),
  }).parse(request.body ?? {});
  if (!body.plan && body.additionalAiCredits === 0) throw new HttpError(400, 'entitlement_change_required');
  return database.withWorkspace(actor.workspaceId, async (tx) => {
    const current = await usageSnapshot(tx);
    const usage = await updateEntitlement(tx, body.plan ?? current.plan, body.additionalAiCredits);
    const resumedRuns = usage.status === 'paused' ? 0 : await resumeBillingPausedRuns(tx);
    await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)', [actor.workspaceId, actor.actorId, 'billing.entitlement_updated', { plan: usage.plan, additionalAiCredits: body.additionalAiCredits, resumedRuns }]);
    return { usage, resumedRuns };
  });
});

app.get('/api/audit-events', async (request) => {
  const actor = actorFrom(request);
  requirePermission(actor.role, 'workspace:manage');
  const events = await database.withWorkspace(actor.workspaceId, (tx) => tx.query('SELECT id, run_id AS "runId", event_type AS "eventType", payload, created_at AS "createdAt" FROM audit_event WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100', [actor.workspaceId]));
  return events.rows;
});

await app.listen({ port: config.GATEWAY_PORT, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => database.close()));
}
}

void main();
