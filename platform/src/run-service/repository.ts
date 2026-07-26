import type { ActorContext, RunStatus, WorkflowRunRequest } from '../contracts/domain';
import { actionPlanSchema, type ActionPlan, type AiRuntimeEvent } from '../contracts/ai-runtime-event';
import type { TenantTransaction } from '../foundation/database';
import { nextStatusAfterApproval } from './state-machine';

export interface RunRecord { id: string; status: RunStatus; workflowId: string; createdAt: string; }

export async function createDurableRun(tx: TenantTransaction, actor: ActorContext, request: WorkflowRunRequest): Promise<RunRecord> {
  const workflow = await tx.query<{ id: string }>(
    `SELECT w.id
       FROM workflow w
       JOIN workflow_version v ON v.workflow_id = w.id AND v.version = $2
      WHERE w.id = $1 AND w.workspace_id = $3 AND w.status = 'published'`,
    [request.workflowId, request.workflowVersion, actor.workspaceId],
  );
  if (!workflow.rows[0]) throw new Error('Workflow is not available in this workspace');
  const created = await tx.query<RunRecord>(
    `INSERT INTO workflow_run (workspace_id, workflow_id, workflow_version, status, idempotency_key, input, context_snapshot, requested_by)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, status, workflow_id AS "workflowId", created_at::text AS "createdAt"`,
    [actor.workspaceId, request.workflowId, request.workflowVersion, request.idempotencyKey, request.input, request.context, actor.actorId],
  );
  const run = created.rows[0] ?? (await tx.query<RunRecord>(
    'SELECT id, status, workflow_id AS "workflowId", created_at::text AS "createdAt" FROM workflow_run WHERE workspace_id = $1 AND idempotency_key = $2',
    [actor.workspaceId, request.idempotencyKey],
  )).rows[0];
  if (!run) throw new Error('Run creation did not return a record');
  if (!created.rows[0]) return run;
  await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5)', [actor.workspaceId, run.id, `run:${run.id}:created`, 'run.created', { workflowId: request.workflowId }]);
  await tx.query('INSERT INTO job (workspace_id, run_id, kind, payload) VALUES ($1, $2, $3, $4)', [actor.workspaceId, run.id, 'prepare_ai_run', { runId: run.id }]);
  return run;
}

export async function decideApproval(tx: TenantTransaction, actor: ActorContext, approvalId: string, decision: 'approved' | 'rejected', reason?: string): Promise<{ runId: string; status: string }> {
  const approval = await tx.query<{ runId: string; actionPlan: ActionPlan }>("UPDATE approval_request SET status = $2, decided_by = $3, decided_at = now(), decision_reason = $4 WHERE id = $1 AND workspace_id = $5 AND status = 'pending' RETURNING run_id AS \"runId\", requested_action AS \"actionPlan\"", [approvalId, decision, actor.actorId, reason ?? null, actor.workspaceId]);
  const row = approval.rows[0];
  if (!row) throw new Error('Approval request not found or already decided');
  const status = nextStatusAfterApproval(decision);
  const transitioned = await tx.query<{ id: string }>("UPDATE workflow_run SET status = $3, finished_at = CASE WHEN $3 = 'cancelled' THEN now() ELSE finished_at END WHERE id = $1 AND workspace_id = $2 AND status = 'waiting_approval' RETURNING id", [row.runId, actor.workspaceId, status]);
  if (!transitioned.rows[0]) throw new Error('Run is not waiting for approval');
  await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5)', [actor.workspaceId, row.runId, `approval:${approvalId}:${decision}`, `approval.${decision}`, { approvalId, reason }]);
  if (decision === 'approved') await tx.query('INSERT INTO job (workspace_id, run_id, kind, payload) VALUES ($1, $2, $3, $4)', [actor.workspaceId, row.runId, 'execute_approved_actions', { runId: row.runId, actionPlan: actionPlanSchema.parse(row.actionPlan) }]);
  return { runId: row.runId, status };
}

export async function ingestAiRuntimeEvent(tx: TenantTransaction, event: AiRuntimeEvent): Promise<void> {
  const run = await tx.query<{ id: string; status: RunStatus }>(
    'SELECT id, status FROM workflow_run WHERE id = $1 AND workspace_id = $2',
    [event.platformRunId, event.workspaceId],
  );
  if (!run.rows[0]) throw new Error('Platform run not found');

  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (run_id, event_key) DO NOTHING
     RETURNING id`,
    [event.workspaceId, event.platformRunId, `ai:${event.eventId}`, event.type, { aiRunId: event.aiRunId, ...event.payload }],
  );
  if (!inserted.rows[0]) return;

  if (event.type === 'action_plan.created') {
    const actionPlan = actionPlanSchema.parse(event.payload.actionPlan);
    const transitioned = await tx.query<{ id: string }>(
      "UPDATE workflow_run SET status = 'waiting_approval' WHERE id = $1 AND workspace_id = $2 AND status = 'running' RETURNING id",
      [event.platformRunId, event.workspaceId],
    );
    if (!transitioned.rows[0]) return;
    if (actionPlan.requiresApproval) {
      await tx.query('INSERT INTO approval_request (workspace_id, run_id, status, requested_action) VALUES ($1, $2, \'pending\', $3)', [event.workspaceId, event.platformRunId, actionPlan]);
    } else {
      await tx.query("UPDATE workflow_run SET status = 'queued' WHERE id = $1 AND workspace_id = $2 AND status = 'waiting_approval'", [event.platformRunId, event.workspaceId]);
      await tx.query('INSERT INTO job (workspace_id, run_id, kind, payload) VALUES ($1, $2, $3, $4)', [event.workspaceId, event.platformRunId, 'execute_approved_actions', { runId: event.platformRunId, actionPlan }]);
    }
    return;
  }

  if (event.type === 'ai_run.failed') {
    await tx.query("UPDATE workflow_run SET status = 'failed', finished_at = now() WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'queued', 'running')", [event.platformRunId, event.workspaceId]);
  }
}
