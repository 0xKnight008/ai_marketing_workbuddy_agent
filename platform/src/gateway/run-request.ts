import { z } from 'zod';

import type { ActorContext, WorkflowRunRequest } from '../contracts/domain';
import { requirePermission } from '../foundation/rbac';

const requestSchema = z.object({
  workflowId: z.string().uuid(),
  workflowVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(16).max(200),
  input: z.record(z.unknown()),
  context: z.object({
    tone: z.string().min(1),
    language: z.string().min(2).max(10),
    forbiddenWords: z.array(z.string()),
    approvalPolicy: z.enum(['required', 'auto_approve', 'none']),
    allowedModelClasses: z.array(z.string().min(1)).min(1),
  }),
}).strict();

export interface RunServicePort {
  createRun(actor: ActorContext, request: WorkflowRunRequest): Promise<{ runId: string; status: 'pending' }>;
}

export async function createWorkflowRun(
  actor: ActorContext,
  body: unknown,
  runService: RunServicePort,
): Promise<{ runId: string; status: 'pending' }> {
  requirePermission(actor.role, 'workflow:run');
  const request = requestSchema.parse(body);
  if (request.context.approvalPolicy === 'none') {
    requirePermission(actor.role, 'workspace:manage');
  }
  return runService.createRun(actor, request);
}
