import type { ClaimedJob, RunWorkerDatabase } from './worker-runner';
import type { TenantTransaction } from '../foundation/database';

export class JobLeaseLost extends Error {
  constructor() { super('job_lease_lost'); }
}

/** Renew and fence every result transaction by the exact claim, not just the job ID. */
export async function withJobLease<T>(database: RunWorkerDatabase, job: ClaimedJob, workerName: string,
  operation: (scoped: RunWorkerDatabase) => Promise<T>, intervalMs = 30_000): Promise<T> {
  let lost = false;
  let pending: Promise<void> | undefined;
  const lock = async (tx: TenantTransaction) => {
    if (lost) throw new JobLeaseLost();
    const result = await tx.query(`UPDATE job SET locked_at = now()
      WHERE id = $1 AND workspace_id = $2 AND locked_by = $3 AND attempt = $4
        AND status = 'running' AND locked_at > now() - interval '5 minutes'`,
    [job.id, job.workspaceId, workerName, job.attempt]);
    if (result.rowCount !== 1) { lost = true; throw new JobLeaseLost(); }
  };
  const scoped: RunWorkerDatabase = {
    claimNextJob: name => database.claimNextJob(name),
    withWorkspace: (workspaceId, fn) => {
      if (workspaceId !== job.workspaceId) throw new JobLeaseLost();
      return database.withWorkspace(workspaceId, async tx => {
        // The row lock lasts through the result/credit/audit transaction.
        await lock(tx);
        return fn(tx);
      });
    },
  };
  await database.withWorkspace(job.workspaceId, lock);
  const timer = setInterval(() => {
    if (pending || lost) return;
    pending = database.withWorkspace(job.workspaceId, lock)
      .catch(() => { lost = true; })
      .finally(() => { pending = undefined; });
  }, intervalMs);
  timer.unref();
  try { return await operation(scoped); }
  finally { clearInterval(timer); await pending; }
}
