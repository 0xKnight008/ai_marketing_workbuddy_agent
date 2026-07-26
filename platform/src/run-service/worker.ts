import { z } from 'zod';

import { AiRuntimeClient } from '../ai-runtime/client';
import { actionPlanSchema, type ActionPlan } from '../contracts/ai-runtime-event';
import { assertExecutableAction, type ConnectedAccountView } from '../connector-service/actions';
import { Database } from '../foundation/database';
import { decryptSecret } from '../foundation/secrets';
import { ZernioClient } from '../zernio/client';

const config = z.object({
  DATABASE_URL: z.string().url(),
  AI_RUNTIME_URL: z.string().url(),
  INTERNAL_SERVICE_TOKEN: z.string().min(1),
  SECRET_ENCRYPTION_KEY_BASE64: z.string().min(1).optional(),
  ZERNIO_BASE_URL: z.string().url().optional(),
  WORKER_NAME: z.string().min(1).default('run-worker-1'),
  WORKER_IDLE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
}).parse(process.env);

const database = new Database(config.DATABASE_URL);
const aiRuntime = new AiRuntimeClient({ baseUrl: config.AI_RUNTIME_URL, internalToken: config.INTERNAL_SERVICE_TOKEN });
const zernio = config.ZERNIO_BASE_URL
  ? new ZernioClient({ baseUrl: config.ZERNIO_BASE_URL, oauthClientId: 'worker', oauthRedirectUri: 'http://localhost/unused', oauthStateSecret: 'worker-not-used' })
  : undefined;

interface ClaimedJob {
  id: string;
  workspaceId: string;
  runId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempt: number;
}

async function executePrepare(job: ClaimedJob): Promise<void> {
  if (!job.runId) throw new Error('prepare_ai_run is missing runId');
  const run = await database.withWorkspace(job.workspaceId, async (tx) => {
    const result = await tx.query<{ id: string; input: Record<string, unknown>; context: Record<string, unknown>; requestedBy: string }>(
      'SELECT id, input, context_snapshot AS context, requested_by AS "requestedBy" FROM workflow_run WHERE id = $1 AND workspace_id = $2',
      [job.runId, job.workspaceId],
    );
    const found = result.rows[0];
    if (!found) throw new Error('Run not found');
    await tx.query("UPDATE workflow_run SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'queued')", [found.id, job.workspaceId]);
    return found;
  });

  const accepted = await aiRuntime.prepareAnnouncement({ platformRunId: run.id, workspaceId: job.workspaceId, actorId: run.requestedBy, input: run.input, executionContext: run.context });
  await database.withWorkspace(job.workspaceId, async (tx) => {
    await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, event_key) DO NOTHING', [job.workspaceId, run.id, `ai:${accepted.aiRunId}:accepted`, 'ai_run.accepted', accepted]);
    await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
  });
}

async function executeApprovedActions(job: ClaimedJob): Promise<void> {
  if (!job.runId) throw new Error('execute_approved_actions is missing runId');
  const actionPlan = actionPlanSchema.parse(job.payload.actionPlan) as ActionPlan;
  for (const action of actionPlan.actions) {
    const operation = await database.withWorkspace(job.workspaceId, async (tx) => {
      const run = await tx.query<{ status: string }>('SELECT status FROM workflow_run WHERE id = $1 AND workspace_id = $2', [job.runId, job.workspaceId]);
      if (!run.rows[0] || !['queued', 'running'].includes(run.rows[0].status)) throw new Error('Run is not ready for action execution');
      const stepKey = `action:${action.stepOrder}`;
      await tx.query(`INSERT INTO step_run (workspace_id, run_id, step_key, status, input, started_at)
        VALUES ($1, $2, $3, 'running', $4, now()) ON CONFLICT (run_id, step_key, attempt) DO NOTHING`, [job.workspaceId, job.runId, stepKey, action]);
      const step = await tx.query<{ id: string; status: string }>('SELECT id, status FROM step_run WHERE run_id = $1 AND step_key = $2 AND attempt = 1', [job.runId, stepKey]);
      const stepRun = step.rows[0];
      if (!stepRun) throw new Error('Action step was not created');
      if (stepRun.status === 'succeeded') return undefined;

      const account = await tx.query<{ id: string; workspaceId: string; status: ConnectedAccountView['status']; capabilities: string[]; ciphertext: string | null; iv: string | null; authTag: string | null }>(
        `SELECT a.id, a.workspace_id AS "workspaceId", a.status, a.capabilities,
                s.ciphertext, s.iv, s.auth_tag AS "authTag"
           FROM connected_account a
           LEFT JOIN secret s ON s.id = a.secret_id
          WHERE a.workspace_id = $1 AND a.provider = 'zernio' AND a.external_account_id = $2`,
        [job.workspaceId, action.accountId],
      );
      const connected = account.rows[0];
      if (!connected || !connected.ciphertext || !connected.iv || !connected.authTag) throw new Error('Connected Zernio account has no usable credential');
      return { stepRunId: stepRun.id, connected, action };
    });
    if (!operation) continue;
    if (!zernio || !config.SECRET_ENCRYPTION_KEY_BASE64) throw new Error('Zernio action execution is not configured');
    const account: ConnectedAccountView = {
      id: operation.connected.id,
      workspaceId: operation.connected.workspaceId,
      status: operation.connected.status,
      capabilities: operation.connected.capabilities,
    };
    assertExecutableAction({ workspaceId: job.workspaceId, runId: job.runId, stepId: operation.stepRunId, attempt: 1, account, type: operation.action.type, payload: operation.action });
    const decrypted = decryptSecret({ ciphertext: operation.connected.ciphertext, iv: operation.connected.iv, authTag: operation.connected.authTag }, config.SECRET_ENCRYPTION_KEY_BASE64);
    const credential = parseZernioCredential(decrypted);
    const accessToken = credential.accessToken;
    const result = await zernio.executeAction(accessToken, operation.action.idempotencyKey, operation.action);
    await database.withWorkspace(job.workspaceId, async (tx) => {
      await tx.query("UPDATE step_run SET status = 'succeeded', output = $2, finished_at = now() WHERE id = $1 AND workspace_id = $3", [operation.stepRunId, result, job.workspaceId]);
      await tx.query("INSERT INTO task_event (workspace_id, run_id, step_run_id, action_type, billable_units, status) VALUES ($1, $2, $3, $4, 1, 'succeeded') ON CONFLICT DO NOTHING", [job.workspaceId, job.runId, operation.stepRunId, operation.action.type]);
    });
  }
  await database.withWorkspace(job.workspaceId, async (tx) => {
    await tx.query("UPDATE workflow_run SET status = 'succeeded', finished_at = now() WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')", [job.runId, job.workspaceId]);
    await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
  });
}

async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await database.withWorkspace(job.workspaceId, async (tx) => {
    const result = await tx.query<{ status: string }>("UPDATE job SET status = CASE WHEN attempt >= max_attempts THEN 'dead_lettered'::job_status ELSE 'queued'::job_status END, available_at = now() + interval '30 seconds', locked_at = NULL, locked_by = NULL, last_error = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING status", [job.id, job.workspaceId, message]);
    if (result.rows[0]?.status === 'dead_lettered' && job.runId) {
      await tx.query("UPDATE workflow_run SET status = 'dead_lettered', finished_at = now() WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'queued', 'running')", [job.runId, job.workspaceId]);
      await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, event_key) DO NOTHING', [job.workspaceId, job.runId, `job:${job.id}:dead_lettered`, 'run.dead_lettered', { error: message }]);
    }
  });
}

async function executeOne(): Promise<boolean> {
  const job = await database.claimNextJob(config.WORKER_NAME);
  if (!job) return false;
  try {
    if (job.kind === 'prepare_ai_run') await executePrepare(job);
    else if (job.kind === 'execute_approved_actions') await executeApprovedActions(job);
    else throw new Error(`Unsupported job: ${job.kind}`);
  } catch (error) {
    await failJob(job, error);
  }
  return true;
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; });

while (!stopping) {
  if (!await executeOne()) await new Promise((resolve) => setTimeout(resolve, config.WORKER_IDLE_MS));
}
await database.close();

function parseZernioCredential(value: string): { accessToken: string } {
  try {
    const parsed = JSON.parse(value) as { accessToken?: unknown };
    if (typeof parsed.accessToken === 'string' && parsed.accessToken) return { accessToken: parsed.accessToken };
  } catch {
    // Accept the legacy single-token secret format during migration.
  }
  if (value) return { accessToken: value };
  throw new Error('Connected Zernio account credential is invalid');
}
