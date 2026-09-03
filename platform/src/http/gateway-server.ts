import { createHmac, timingSafeEqual } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { aiRuntimeEventSchema } from '../contracts/ai-runtime-event';
import { usageSnapshot } from '../billing/guardrails';
import type { ActorContext } from '../contracts/domain';
import { Database } from '../foundation/database';
import { loadGatewayConfig } from '../foundation/platform-config';
import type { PlatformOrm } from '../foundation/sequelize';
import { requirePermission } from '../foundation/rbac';
import { PlatformService } from '../egg/platform-service';
import { createPublishedTemplate } from '../gateway/templates';
import { verifyAccessToken } from '../identity/token';
import { createWorkflowRun } from '../gateway/run-request';
import { createDurableRun, decideApproval, ingestAiRuntimeEvent } from '../run-service/repository';
import { HttpError, publicError } from './errors';

async function main(): Promise<void> {

const config = loadGatewayConfig();

const database = new Database(config.DATABASE_URL);
const platformService = new PlatformService(config, database, {} as PlatformOrm);
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
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
  done(null, Object.fromEntries(new URLSearchParams(String(body))));
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

function adminTokenFrom(request: FastifyRequest): string | undefined {
  const value = request.headers['x-billing-admin-token'];
  return typeof value === 'string' ? value : undefined;
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
  const raw = rawBodies.get(request);
  const signature = request.headers['stripe-signature'];
  if (!raw || typeof signature !== 'string') throw new HttpError(401, 'stripe_signature_missing');
  return reply.code(200).send(await platformService.ingestStripeWebhook(raw, signature));
});

app.post('/api/activation/exchange', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return platformService.exchangeActivationTicket(request.body);
});

app.post('/api/workflow-templates/:templateId/publish', async (request, reply) => {
  const actor = actorFrom(request);
  const { templateId } = z.object({ templateId: z.enum(['repurpose', 'weekly_report', 'comment_lead']) }).parse(request.params);
  return reply.code(201).send(await database.withWorkspace(actor.workspaceId, (tx) => createPublishedTemplate(tx, actor, templateId)));
});

app.get('/api/zernio/connect', async (request) => {
  const actor = actorFrom(request);
  const query = z.object({ platform: z.string() }).parse(request.query);
  return { url: await platformService.connectUrl(actor, query.platform) };
});

app.get('/api/zernio/callback', async (request, reply) => {
  const result = await platformService.completeZernioOAuth(request.query as Record<string, unknown>);
  return reply.code(200).header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').type('text/html').send(
    result.kind === 'selection' ? legacySelectionPage(result.platform, result.choices) : legacySuccessPage(),
  );
});

app.post('/api/zernio/select', async (request, reply) => {
  const body = z.object({ selection: z.string().min(1) }).parse(request.body);
  await platformService.selectZernioAccount(body.selection);
  return reply.code(200).header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').type('text/html').send(legacySuccessPage());
});

app.post('/api/zernio/sync', async (request) => {
  const actor = actorFrom(request);
  return platformService.syncZernio(actor);
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
  return platformService.createStripeCheckout(actor, request.body);
});

// This endpoint is intended to be called by the verified payment webhook or
// an owner-only admin console. It never accepts payment details itself.
app.post('/api/billing/entitlements', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  return platformService.updateBillingEntitlements(actorFrom(request), adminTokenFrom(request), request.body);
});

app.get('/api/admin/workspaces', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  return platformService.adminWorkspaces(actorFrom(request), adminTokenFrom(request), request.query);
});

app.post('/api/admin/workspaces/:workspaceId/entitlements', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
  return platformService.adminUpdateEntitlements(actorFrom(request), adminTokenFrom(request), workspaceId, request.body);
});

app.get('/api/admin/feedback', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  return platformService.adminFeedback(actorFrom(request), adminTokenFrom(request), request.query);
});

app.patch('/api/admin/feedback/:ticketNo', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  const { ticketNo } = z.object({ ticketNo: z.string() }).parse(request.params);
  return platformService.adminUpdateFeedback(actorFrom(request), adminTokenFrom(request), ticketNo, request.body);
});

app.get('/api/admin/jobs', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  return platformService.adminDeadLetterJobs(actorFrom(request), adminTokenFrom(request), request.query);
});

app.post('/api/admin/jobs/:jobId/replay', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
  return platformService.adminReplayJob(actorFrom(request), adminTokenFrom(request), jobId, request.body);
});

app.get('/api/admin/referrals', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  return platformService.adminReferrals(actorFrom(request), adminTokenFrom(request), request.query);
});

app.post('/api/admin/referrals/:ledgerId/void', async (request, reply) => {
  reply.header('cache-control', 'no-store');
  const { ledgerId } = z.object({ ledgerId: z.string().uuid() }).parse(request.params);
  return platformService.adminVoidReferral(actorFrom(request), adminTokenFrom(request), ledgerId, request.body);
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

function legacySuccessPage(): string {
  return '<!doctype html><meta charset="utf-8"><title>Piggybot</title><main><h1>Account connected</h1><p>Your social account is ready in Piggybot. You may close this window.</p></main>';
}

function legacySelectionPage(platform: string, choices: Array<{ label: string; detail?: string; token: string }>): string {
  const options = choices.map((choice, index) => `<label><input type="radio" name="selection" value="${choice.token}" ${index === 0 ? 'checked' : ''} required> ${escapeLegacyHtml(choice.label)}${choice.detail ? ` — ${escapeLegacyHtml(choice.detail)}` : ''}</label><br>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Choose ${escapeLegacyHtml(platform)} · Piggybot</title><main><h1>Choose your ${escapeLegacyHtml(platform)} account</h1><form method="post" action="/api/zernio/select">${options}<button type="submit">Connect selected account</button></form></main>`;
}

function escapeLegacyHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
