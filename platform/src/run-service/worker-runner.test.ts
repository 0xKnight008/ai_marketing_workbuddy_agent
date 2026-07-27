import assert from 'node:assert/strict';
import test from 'node:test';

import type { TenantTransaction } from '../foundation/database';
import { RunWorker, type ClaimedJob, type RunWorkerDatabase } from './worker-runner';

test('RunWorker drains a bounded batch and requeues unsupported work safely', async () => {
  const jobs: ClaimedJob[] = [
    { id: 'job-1', workspaceId: 'workspace-1', runId: null, kind: 'unknown', payload: {}, attempt: 1 },
    { id: 'job-2', workspaceId: 'workspace-1', runId: null, kind: 'unknown', payload: {}, attempt: 1 },
  ];
  const statements: string[] = [];
  const transaction: TenantTransaction = {
    async query(sql) {
      statements.push(sql);
      return { rows: [], rowCount: 1 };
    },
  };
  const database: RunWorkerDatabase = {
    async claimNextJob() { return jobs.shift(); },
    async withWorkspace(_workspaceId, operation) { return operation(transaction); },
  };
  const worker = new RunWorker({
    workerName: 'test-worker',
    database,
    aiRuntime: { async prepareAnnouncement() { return { aiRunId: 'unused', status: 'accepted' as const }; } },
  });

  assert.equal(await worker.drain(1), 1);
  assert.equal(jobs.length, 1);
  assert.equal(statements.length, 1);
  assert.match(statements[0] ?? '', /UPDATE job SET status = CASE/);
});
