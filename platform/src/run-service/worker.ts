import { z } from 'zod';
import { AiRuntimeClient } from '../ai-runtime/client';
import { Database } from '../foundation/database';

const config = z.object({
  DATABASE_URL: z.string().url(),
  AI_RUNTIME_URL: z.string().url(),
  INTERNAL_SERVICE_TOKEN: z.string().min(1),
  WORKER_NAME: z.string().min(1).default('run-worker-1'),
}).parse(process.env);

const database = new Database(config.DATABASE_URL);
const aiRuntime = new AiRuntimeClient({ baseUrl: config.AI_RUNTIME_URL, internalToken: config.INTERNAL_SERVICE_TOKEN });

async function executeOne(): Promise<boolean> {
  const job = await database.claimNextJob(config.WORKER_NAME);
  if (!job) return false;
  try {
    if (job.kind !== 'prepare_ai_run' || !job.runId) throw new Error(`Unsupported job: ${job.kind}`);
    await database.withWorkspace(job.workspaceId, async (tx) => {
      const result = await tx.query<{ id: string; input: Record<string, unknown>; context: Record<string, unknown>; requestedBy: string }>(
        'SELECT id, input, context_snapshot AS context, requested_by AS "requestedBy" FROM workflow_run WHERE id = $1', [job.runId],
      );
      const run = result.rows[0];
      if (!run) throw new Error('Run not found');
      await tx.query("UPDATE workflow_run SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1", [run.id]);
      const accepted = await aiRuntime.prepareAnnouncement({ platformRunId: run.id, workspaceId: job.workspaceId, actorId: run.requestedBy, input: run.input, executionContext: run.context });
      await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5)', [job.workspaceId, run.id, `ai:${accepted.aiRunId}:accepted`, 'ai_run.accepted', accepted]);
      await tx.query("UPDATE job SET status = 'succeeded', updated_at = now() WHERE id = $1", [job.id]);
    });
  } catch (error) {
    await database.withWorkspace(job.workspaceId, (tx) => tx.query("UPDATE job SET status = CASE WHEN attempt >= max_attempts THEN 'dead_lettered'::job_status ELSE 'queued'::job_status END, available_at = now() + interval '30 seconds', last_error = $2, updated_at = now() WHERE id = $1", [job.id, error instanceof Error ? error.message : String(error)]));
  }
  return true;
}

while (await executeOne()) { /* drain currently ready jobs */ }
await database.close();
