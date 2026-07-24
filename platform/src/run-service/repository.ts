import type { ActorContext, RunStatus, WorkflowRunRequest } from '../contracts/domain';
import type { TenantTransaction } from '../foundation/database';

export interface RunRecord { id: string; status: RunStatus; workflowId: string; createdAt: string; }

export async function createDurableRun(tx: TenantTransaction, actor: ActorContext, request: WorkflowRunRequest): Promise<RunRecord> {
  const existing = await tx.query<RunRecord>(
    'SELECT id, status, workflow_id AS "workflowId", created_at::text AS "createdAt" FROM workflow_run WHERE workspace_id = $1 AND idempotency_key = $2',
    [actor.workspaceId, request.idempotencyKey],
  );
  if (existing.rows[0]) return existing.rows[0];
  const created = await tx.query<RunRecord>(
    `INSERT INTO workflow_run (workspace_id, workflow_id, workflow_version, status, idempotency_key, input, context_snapshot, requested_by)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
     RETURNING id, status, workflow_id AS "workflowId", created_at::text AS "createdAt"`,
    [actor.workspaceId, request.workflowId, request.workflowVersion, request.idempotencyKey, request.input, request.context, actor.actorId],
  );
  const run = created.rows[0];
  if (!run) throw new Error('Run creation did not return a record');
  await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5)', [actor.workspaceId, run.id, `run:${run.id}:created`, 'run.created', { workflowId: request.workflowId }]);
  await tx.query('INSERT INTO job (workspace_id, run_id, kind, payload) VALUES ($1, $2, $3, $4)', [actor.workspaceId, run.id, 'prepare_ai_run', { runId: run.id }]);
  return run;
}

export async function decideApproval(tx: TenantTransaction, actor: ActorContext, approvalId: string, decision: 'approved' | 'rejected', reason?: string): Promise<{ runId: string; status: string }> {
  const approval = await tx.query<{ runId: string }>("UPDATE approval_request SET status = $2, decided_by = $3, decided_at = now(), decision_reason = $4 WHERE id = $1 AND status = 'pending' RETURNING run_id AS \"runId\"", [approvalId, decision, actor.actorId, reason ?? null]);
  const row = approval.rows[0];
  if (!row) throw new Error('Approval request not found or already decided');
  const status = decision === 'approved' ? 'queued' : 'cancelled';
  await tx.query('UPDATE workflow_run SET status = $2 WHERE id = $1', [row.runId, status]);
  await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5)', [actor.workspaceId, row.runId, `approval:${approvalId}:${decision}`, `approval.${decision}`, { approvalId, reason }]);
  if (decision === 'approved') await tx.query('INSERT INTO job (workspace_id, run_id, kind, payload) VALUES ($1, $2, $3, $4)', [actor.workspaceId, row.runId, 'execute_approved_actions', { runId: row.runId }]);
  return { runId: row.runId, status };
}
