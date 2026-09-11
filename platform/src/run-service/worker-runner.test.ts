import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';

import type { TenantTransaction } from '../foundation/database';
import { RunWorker, type ClaimedJob, type RunWorkerDatabase } from './worker-runner';

for (const kind of ['prepare_ai_run', 'execute_approved_actions']) {
  test(`worker does not call suppliers for inactive subscriptions (${kind})`, async () => {
    const statements: string[] = [];
    const tx: TenantTransaction = { query: (async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM workflow_run r')) return { rows: [{ id: 'run-1', input: {}, context: { allowedModelClasses: ['eco'] }, definition: { steps: [{ type: 'ai.prepare_announcement' }, { type: 'approval' }, { type: 'social.schedule_post' }] } }], rowCount: 1 };
      if (sql.startsWith('SELECT status FROM workflow_run')) return { rows: [{ status: 'queued' }], rowCount: 1 };
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', subscriptionStatus: 'inactive', trialEndsAt: null, paymentGraceEndsAt: null }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }) as TenantTransaction['query'] };
    let calls = 0;
    const worker = new RunWorker({ workerName: 'review-test', database: {
      claimNextJob: async () => ({ id: 'job-1', runId: 'run-1', workspaceId: 'workspace-1', kind, attempt: 1, payload: { actionPlan: {
        summary: 'Post', requiresApproval: true, actions: [{ stepOrder: 1, type: 'social.create_post', platform: 'linkedin', accountId: 'account-1', content: 'Hello', idempotencyKey: 'run-1:post', requiresApproval: true }],
      } } }),
      withWorkspace: async (_workspaceId, operation) => operation(tx),
    }, aiRuntime: {
      prepareAnnouncement: async () => { calls++; return { aiRunId: 'ai-run-1', status: 'accepted' }; },
      getAnnouncementRun: async () => { throw new Error('unexpected'); },
      classifyItems: async () => { throw new Error('unexpected'); },
    }, zernio: { executeAction: async () => { calls++; } } });
    await worker.runOne();
    assert.equal(calls, 0);
    assert.ok(statements.some((sql) => sql.includes("status = 'waiting_approval'")));
    assert.equal(statements.some((sql) => sql.includes('INSERT INTO task_event')), false);
  });
}

test('RunWorker drains a bounded batch and requeues unsupported work safely', async () => {
  const jobs: ClaimedJob[] = [
    { id: 'job-1', workspaceId: 'workspace-1', runId: null, kind: 'unknown', payload: {}, attempt: 1 },
    { id: 'job-2', workspaceId: 'workspace-1', runId: null, kind: 'unknown', payload: {}, attempt: 1 },
  ];
  const statements: string[] = [];
  const transaction: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, _values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
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
    aiRuntime: {
      async prepareAnnouncement() { return { aiRunId: 'unused', status: 'accepted' as const }; },
      async getAnnouncementRun() { return { aiRunId: 'unused', platformRunId: 'unused', workspaceId: 'workspace-1', status: 'running' as const }; },
      async classifyItems() { return {}; },
    },
  });

  assert.equal(await worker.drain(1), 1);
  assert.equal(jobs.length, 1);
  assert.equal(statements.length, 1);
  assert.match(statements[0] ?? '', /UPDATE job SET status = CASE/);
});

test('RunWorker reconciles a completed AI run when its callback was lost', async () => {
  const statements: string[] = [];
  const transaction: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, _values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.startsWith('SELECT id, status FROM workflow_run')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111', status: 'running' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO run_event')) return { rows: [{ id: 'event-1' }] as unknown as Row[], rowCount: 1 };
      if (sql.startsWith("UPDATE workflow_run SET status = 'waiting_approval'")) return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] as unknown as Row[], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  let claimed = false;
  const database: RunWorkerDatabase = {
    async claimNextJob() {
      if (claimed) return undefined;
      claimed = true;
      return {
        id: 'job-1',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        runId: '11111111-1111-4111-8111-111111111111',
        kind: 'reconcile_ai_run',
        payload: { aiRunId: 'ai-run-1' },
        attempt: 1,
      };
    },
    async withWorkspace(_workspaceId, operation) { return operation(transaction); },
  };
  const worker = new RunWorker({
    workerName: 'test-worker',
    database,
    aiRuntime: {
      async prepareAnnouncement() { return { aiRunId: 'unused', status: 'accepted' as const }; },
      async getAnnouncementRun() {
        return {
          aiRunId: 'ai-run-1',
          platformRunId: '11111111-1111-4111-8111-111111111111',
          workspaceId: '22222222-2222-4222-8222-222222222222',
          status: 'succeeded' as const,
          result: {
            actionPlan: {
              summary: 'Publish',
              requiresApproval: true,
              blockedByCompliance: false,
              actions: [{
                stepOrder: 1,
                type: 'social.create_post',
                platform: 'telegram',
                accountId: 'account-1',
                content: 'hello',
                hashtags: [],
                mode: 'publish_now',
                idempotencyKey: 'run-1:post:telegram:account-1',
                requiresApproval: true,
              }],
            },
          },
        };
      },
      async classifyItems() { return {}; },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO approval_request')));
  assert.ok(statements.some((sql) => sql.includes("UPDATE job SET status = 'succeeded'")));
});

test('import.classify writes evidence-verified tags and drops hallucinated citations', async () => {
  const items = [
    { id: 'item-1', text: 'Love this serum, where can I buy it?', author: 'Ann', platform: 'instagram' },
    { id: 'item-2', text: 'The new packaging leaks everywhere', author: null, platform: 'rednote' },
  ];
  let pendingCalls = 0;
  const statements: string[] = [];
  const insertedTags: unknown[][] = [];
  const auditEvents: unknown[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO audit_event')) auditEvents.push(values?.[1]);
      if (sql.includes("UPDATE import_batch SET status = 'classifying'")) {
        return { rows: [{ status: 'classifying', modelBand: 'standard' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('classified_at IS NULL')) {
        pendingCalls += 1;
        return { rows: (pendingCalls === 1 ? items : []) as unknown as Row[], rowCount: 0 };
      }
      if (sql.startsWith('INSERT INTO item_tag')) {
        insertedTags.push([...(values ?? [])]);
        return { rows: [] as Row[], rowCount: 1 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-9', workspaceId: 'workspace-1', runId: null, kind: 'import.classify', payload: { batchId: 'batch-1' }, attempt: 1 }];
  const worker = new RunWorker({
    workerName: 'test-worker',
    database: {
      claimNextJob: async () => jobs.shift(),
      withWorkspace: async (_workspaceId, operation) => operation(tx),
    },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems(payload) {
        assert.equal((payload as { modelBand: string }).modelBand, 'standard');
        return {
          assignments: [
            // 合法：evidence 是原文逐字子串。
            { itemIndex: 0, tags: [{ tag: 'purchase_intent', confidence: 0.92, evidence: 'where can I buy it' }] },
            // 幻觉引用：不在原文中，必须被平台侧丢弃并审计。
            { itemIndex: 1, tags: [{ tag: 'complaint', confidence: 0.9, evidence: 'terrible quality control' }] },
          ],
        };
      },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.equal(insertedTags.length, 1);
  assert.equal(insertedTags[0]?.[0], 'item-1');
  assert.equal(insertedTags[0]?.[1], 'purchase_intent');
  assert.ok(auditEvents.includes('import.classify_evidence_dropped'));
  assert.ok(statements.some((sql) => sql.includes('UPDATE import_item SET classified_at')));
  assert.ok(statements.some((sql) => sql.includes("UPDATE import_batch SET status = 'classified'")));
  assert.ok(statements.some((sql) => sql.includes("UPDATE job SET status = 'succeeded'")));
});

test('import.classify retries when the AI runtime returns a schema-invalid result', async () => {
  const statements: string[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.includes("UPDATE import_batch SET status = 'classifying'")) {
        return { rows: [{ status: 'classifying', modelBand: 'eco' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('classified_at IS NULL')) {
        return { rows: [{ id: 'item-1', text: 'hello', author: null, platform: 'unknown' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE job SET status')) {
        return { rows: [{ status: 'queued' }] as unknown as Row[], rowCount: 1 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-10', workspaceId: 'workspace-1', runId: null, kind: 'import.classify', payload: { batchId: 'batch-1' }, attempt: 1 }];
  const worker = new RunWorker({
    workerName: 'test-worker',
    database: {
      claimNextJob: async () => jobs.shift(),
      withWorkspace: async (_workspaceId, operation) => operation(tx),
    },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { return { nonsense: true }; },
    },
  });

  // Schema-invalid AI output must not be persisted; the job is requeued for retry.
  assert.equal(await worker.runOne(), true);
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO item_tag')), false);
  assert.equal(statements.some((sql) => sql.includes("UPDATE import_batch SET status = 'classified'")), false);
  assert.ok(statements.some((sql) => sql.startsWith('UPDATE job SET status')));
});
