import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ActorContext } from '../contracts/domain';
import { Database } from '../foundation/database';
import { verifyAccessToken } from '../identity/token';
import { createWorkflowRun } from '../gateway/run-request';
import { createDurableRun } from '../run-service/repository';
import { decideApproval } from '../run-service/repository';
import { requirePermission } from '../foundation/rbac';

const config = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_TOKEN_SECRET: z.string().min(32),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
}).parse(process.env);

const database = new Database(config.DATABASE_URL);
const app = Fastify({ logger: true });
await app.register(cors, { origin: false });

function actorFrom(request: FastifyRequest): ActorContext {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer token');
  return verifyAccessToken(authorization.slice('Bearer '.length), config.AUTH_TOKEN_SECRET);
}

app.get('/internal/health', async () => ({ ok: true, service: 'gateway' }));

app.post('/api/workflow-runs', async (request, reply) => {
  try {
    const actor = actorFrom(request);
    const created = await createWorkflowRun(actor, request.body, {
      createRun: (context, runRequest) => database.withWorkspace(context.workspaceId, async (tx) => {
        const run = await createDurableRun(tx, context, runRequest);
        return { runId: run.id, status: 'pending' as const };
      }),
    });
    return reply.code(202).send(created);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'invalid_request' });
  }
});

app.get('/api/runs/:runId', async (request, reply) => {
  try {
    const actor = actorFrom(request);
    const params = z.object({ runId: z.string().uuid() }).parse(request.params);
    const run = await database.withWorkspace(actor.workspaceId, async (tx) => {
      const result = await tx.query<{ id: string; status: string; workflowId: string; createdAt: string }>(
        'SELECT id, status, workflow_id AS "workflowId", created_at::text AS "createdAt" FROM workflow_run WHERE id = $1',
        [params.runId],
      );
      return result.rows[0];
    });
    return run ? reply.send(run) : reply.code(404).send({ error: 'run_not_found' });
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'invalid_request' });
  }
});

app.post('/api/approval-requests/:approvalId/:decision', async (request, reply) => {
  try {
    const actor = actorFrom(request);
    requirePermission(actor.role, 'approval:decide');
    const params = z.object({ approvalId: z.string().uuid(), decision: z.enum(['approved', 'rejected']) }).parse(request.params);
    const body = z.object({ reason: z.string().max(1000).optional() }).parse(request.body ?? {});
    return await database.withWorkspace(actor.workspaceId, (tx) => decideApproval(tx, actor, params.approvalId, params.decision, body.reason));
  } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'invalid_request' }); }
});

app.get('/api/billing/task-events', async (request, reply) => {
  try {
    const actor = actorFrom(request);
    const events = await database.withWorkspace(actor.workspaceId, (tx) => tx.query('SELECT id, run_id AS "runId", action_type AS "actionType", billable_units AS "billableUnits", status, created_at AS "createdAt" FROM task_event ORDER BY created_at DESC LIMIT 100'));
    return reply.send(events.rows);
  } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'invalid_request' }); }
});

app.get('/api/audit-events', async (request, reply) => {
  try {
    const actor = actorFrom(request);
    const events = await database.withWorkspace(actor.workspaceId, (tx) => tx.query('SELECT id, run_id AS "runId", event_type AS "eventType", payload, created_at AS "createdAt" FROM audit_event ORDER BY created_at DESC LIMIT 100'));
    return reply.send(events.rows);
  } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'invalid_request' }); }
});

await app.listen({ port: config.GATEWAY_PORT, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => database.close()));
}
