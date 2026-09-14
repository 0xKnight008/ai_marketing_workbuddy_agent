import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';

import type { TenantTransaction } from '../foundation/database';
import { RunWorker, validatedClassifications, type ClaimedJob, type RunWorkerDatabase } from './worker-runner';

test('500 known-answer classifications require complete indexes and verbatim evidence', () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ text: `Comment ${i}: I want to buy it` }));
  for (let offset = 0; offset < 500; offset += 50) {
    const chunk = items.slice(offset, offset + 50);
    const assignments = chunk.map((_, itemIndex) => ({ itemIndex, tags: [{ tag: 'purchase_intent', confidence: 1, evidence: 'want to buy' }] }));
    assert.equal(validatedClassifications({ assignments }, chunk).length, 50);
    assert.throws(() => validatedClassifications({ assignments: assignments.slice(1) }, chunk), /classification_incomplete/);
    assert.throws(() => validatedClassifications({ assignments: [...assignments, assignments[0]] }, chunk), /invalid_item_index/);
    assert.throws(() => validatedClassifications({ assignments: [{ itemIndex: 50, tags: [] }] }, chunk), /invalid_item_index/);
    assert.throws(() => validatedClassifications({ assignments: assignments.map(a => ({ ...a, tags: [{ tag: 'purchase_intent', confidence: 1, evidence: 'invented' }] })) }, chunk), /invalid_evidence/);
  }
  assert.equal(validatedClassifications({ assignments: [{ itemIndex: 0, tags: [] }] }, [{ text: 'No signal' }]).length, 1);
});

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
      generateInsightReport: async () => { throw new Error('unexpected'); },
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
      async generateInsightReport() { return {}; },
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
      async generateInsightReport() { return {}; },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO approval_request')));
  assert.ok(statements.some((sql) => sql.includes("UPDATE job SET status = 'succeeded'")));
});

test('import.classify rejects hallucinated evidence without committing partial progress', async () => {
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
        if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
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
        /* classify payload */
        return {
          assignments: [
            // 合法：evidence 是原文逐字子串。
            { itemIndex: 0, tags: [{ tag: 'purchase_intent', confidence: 0.92, evidence: 'where can I buy it' }] },
            // 幻觉引用：不在原文中，必须被平台侧丢弃并审计。
            { itemIndex: 1, tags: [{ tag: 'complaint', confidence: 0.9, evidence: 'terrible quality control' }] },
          ],
        };
      },
      async generateInsightReport() { throw new Error('unexpected'); },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.equal(insertedTags.length, 0);
  assert.equal(statements.some((sql) => sql.includes('UPDATE import_item SET classified_at')), false);
  assert.equal(statements.some((sql) => sql.includes("UPDATE import_batch SET status = 'classified'")), false);
  assert.ok(statements.some((sql) => sql.includes('UPDATE job SET status = CASE')));
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
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
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
      async generateInsightReport() { throw new Error('unexpected'); },
    },
  });

  // Schema-invalid AI output must not be persisted; the job is requeued for retry.
  assert.equal(await worker.runOne(), true);
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO item_tag')), false);
  assert.equal(statements.some((sql) => sql.includes("UPDATE import_batch SET status = 'classified'")), false);
  assert.ok(statements.some((sql) => sql.startsWith('UPDATE job SET status')));
});

test('insight.generate stores citation-verified report and drops hallucinated references', async () => {
  const items = [
    { id: 'aaaa-1', platform: 'youtube', author: 'FanA', text: 'I want a plushie so badly, take my money', metrics: { views: 100 }, tags: [{ tag: 'purchase_intent', evidence: 'take my money', confidence: 0.9 }] },
    { id: 'bbbb-2', platform: 'youtube', author: null, text: 'when is the next video', metrics: { views: 5 }, tags: [{ tag: 'urging_update', evidence: 'next video', confidence: 0.8 }] },
  ];
  const statements: string[] = [];
  let persistedReport: Record<string, unknown> | null = null;
  let persistedDropped = -1;
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.includes("UPDATE insight_report SET status = 'generating'")) {
        return { rows: [{ template: 'comment_insights', modelBand: 'eco', batchIds: ['batch-1'] }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM import_item')) {
        return { rows: items as unknown as Row[], rowCount: 2 };
      }
      if (sql.includes("UPDATE insight_report") && sql.includes("'generated'")) {
        persistedReport = JSON.parse(String(values?.[2])) as Record<string, unknown>;
        persistedDropped = Number(values?.[3]);
        if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-11', workspaceId: 'workspace-1', runId: null, kind: 'insight.generate', payload: { reportId: 'report-1' }, attempt: 1 }];
  let capturedPayload: Record<string, unknown> | null = null;
  const worker = new RunWorker({
    workerName: 'test-worker',
    database: {
      claimNextJob: async () => jobs.shift(),
      withWorkspace: async (_workspaceId, operation) => operation(tx),
    },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { throw new Error('unexpected'); },
      async generateInsightReport(payload) {
        capturedPayload = payload;
        return {
          summary: 'Fans want merch.',
          frequentQuestions: [],
          sentimentNotes: [],
          demandRanking: [{ demand: 'Character plushie', approxCount: 1, citations: [
            { ref: 'i1', snippet: 'take my money' },      // 逐字 → 保留
            { ref: 'i1', snippet: 'everyone is buying' }, // 幻觉 → 丢弃
          ] }],
          productOpportunities: [],
          memeMaterial: [],
          highValueComments: [
            { ref: 'i1', reason: 'Strong purchase intent', replyDraft: 'Soon! Thanks for the love.', citations: [] },
            { ref: 'i9', reason: 'Ghost ref', replyDraft: 'x', citations: [] }, // 未知 ref → 整条移除
          ],
        };
      },
    },
  });

  assert.equal(await worker.runOne(), true);
  // 证据包不含租户内部 id，且模板/计数齐全
  assert.ok(capturedPayload);
  const pack = capturedPayload! as { template: string; totals: { items: number }; topItems: Array<{ ref: string }> };
  assert.equal(pack.template, 'comment_insights');
  assert.equal(pack.totals.items, 2);
  assert.ok(pack.topItems.every((item) => /^i\d+$/.test(item.ref)));
  assert.ok(!JSON.stringify(capturedPayload).includes('aaaa-1'));

  assert.ok(persistedReport);
  const body = persistedReport! as unknown as { demandRanking: Array<{ citations: unknown[] }>; highValueComments: unknown[]; _evidence: Record<string, string> };
  assert.equal(body.demandRanking[0]!.citations.length, 1);
  assert.equal(body.highValueComments.length, 1);
  assert.equal(body._evidence.i1, 'aaaa-1');
  assert.equal(persistedDropped, 2);
  assert.ok(statements.some((sql) => sql.includes("UPDATE job SET status = 'succeeded'")));
});

test('insight.generate retries when the AI runtime result fails schema validation', async () => {
  const statements: string[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.includes("UPDATE insight_report SET status = 'generating'")) {
        return { rows: [{ template: 'product_opportunities', modelBand: 'eco', batchIds: ['batch-1'] }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM import_item')) {
        return { rows: [{ id: 'aaaa-1', platform: 'rednote', author: null, text: 'want badges', metrics: {}, tags: [] }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE job SET status')) {
        return { rows: [{ status: 'queued' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-12', workspaceId: 'workspace-1', runId: null, kind: 'insight.generate', payload: { reportId: 'report-1' }, attempt: 1 }];
  const worker = new RunWorker({
    workerName: 'test-worker',
    database: {
      claimNextJob: async () => jobs.shift(),
      withWorkspace: async (_workspaceId, operation) => operation(tx),
    },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { throw new Error('unexpected'); },
      async generateInsightReport() { return { nonsense: true }; },
    },
  });

  // schema 非法不落库，job 重试
  assert.equal(await worker.runOne(), true);
  assert.equal(statements.some((sql) => sql.includes("'generated'")), false);
  assert.ok(statements.some((sql) => sql.startsWith('UPDATE job SET status')));
});

test('insight.generate daily_ops aggregates prior report summaries into the evidence pack', async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      if (sql.includes("UPDATE insight_report SET status = 'generating'")) {
        return { rows: [{ template: 'daily_ops', modelBand: 'eco', batchIds: [] }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM import_item')) return { rows: [] as Row[], rowCount: 0 };
      if (sql.includes("status = 'generated'") && sql.includes('summary')) {
        return { rows: [{ template: 'comment_insights', title: 'Weekly', summary: 'Fans want merch badly.' }] as unknown as Row[], rowCount: 1 };
      }
      void values;
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-13', workspaceId: 'workspace-1', runId: null, kind: 'insight.generate', payload: { reportId: 'report-daily' }, attempt: 1 }];
  const worker = new RunWorker({
    workerName: 'test-worker',
    database: {
      claimNextJob: async () => jobs.shift(),
      withWorkspace: async (_workspaceId, operation) => operation(tx),
    },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { throw new Error('unexpected'); },
      async generateInsightReport(payload) {
        capturedPayload = payload;
        return { summary: 'Today: follow up merch demand.', tasks: [{ title: 'Draft presale poll', reason: 'Comment insights showed strong merch demand', suggestedAction: 'Post poll to community', priority: 'high', dueHint: 'today 18:00', citations: [] }] };
      },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.ok(capturedPayload);
  const payload = capturedPayload! as { template: string; priorReports?: Array<{ summary: string }> };
  assert.equal(payload.template, 'daily_ops');
  assert.equal(payload.priorReports?.[0]?.summary, 'Fans want merch badly.');
});

// ---------- 迭代 4：报告外发（insight.deliver） ----------

const DELIVERY_SNAPSHOT = {
  status: 'approved', channel: 'email', target: 'owner@example.com', targetLabel: 'owner@example.com',
  approvalId: '22222222-2222-4222-8222-222222222222', requestedBy: 'user-1', requestedAt: new Date().toISOString(),
  decidedBy: 'user-1', decidedAt: new Date().toISOString(),
};

function insightDeliveryWorker(options: {
  delivery?: unknown;
  statements: string[];
  auditEvents: unknown[];
  deliveryPatches: unknown[];
  email?: { apiKey: string; from: string };
  zernio?: { executeAction: (key: string, action: Record<string, unknown>, workspaceId?: string) => Promise<unknown> };
}) {
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      options.statements.push(sql);
      if (sql.startsWith('INSERT INTO audit_event')) options.auditEvents.push(values?.[1]);
      if (sql.includes('FROM insight_report')) {
        return { rows: [{
          title: '每周复盘', template: 'daily_ops', itemCount: 42, droppedCitations: 1,
          report: { summary: '摘要', tasks: [{ title: '回复差评', reason: 'r', suggestedAction: '联系买家', priority: 'urgent', dueHint: 'today', citations: [] }] },
          delivery: options.delivery ?? DELIVERY_SNAPSHOT,
        }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM connected_account')) {
        return { rows: [{ id: 'acc-1', workspaceId: 'workspace-1', status: 'connected', capabilities: ['publish'], externalAccountId: 'ext-discord-1' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE insight_report SET delivery = delivery ||')) {
        options.deliveryPatches.push(JSON.parse(String(values?.[2])));
        if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE job SET status')) {
        return { rows: [{ status: 'queued' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const aiRuntime = {
    async prepareAnnouncement() { throw new Error('unexpected'); },
    async getAnnouncementRun() { throw new Error('unexpected'); },
    async classifyItems() { throw new Error('unexpected'); },
    async generateInsightReport() { throw new Error('unexpected'); },
  };
  return new RunWorker({
    workerName: 'delivery-test',
    database: {
      claimNextJob: async () => undefined,
      withWorkspace: async (_workspaceId, operation) => operation(tx),
    },
    aiRuntime,
    ...(options.email ? { email: options.email } : {}),
    ...(options.zernio ? { zernio: options.zernio } : {}),
  });
}

function deliveryJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return { id: 'job-d1', workspaceId: 'workspace-1', runId: null, kind: 'insight.deliver', payload: { reportId: '11111111-1111-4111-8111-111111111111' }, attempt: 1, ...overrides };
}

test('insight.deliver sends the digest email and marks the delivery delivered', async () => {
  const statements: string[] = [];
  const auditEvents: unknown[] = [];
  const deliveryPatches: unknown[] = [];
  const worker = insightDeliveryWorker({ statements, auditEvents, deliveryPatches, email: { apiKey: 'rk', from: 'reports@piggybot.app' } });

  const sent: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
  }) as typeof fetch;
  try {
    await (worker as unknown as { deliverInsight: (job: ClaimedJob) => Promise<void> }).deliverInsight(deliveryJob());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sent.length, 1);
  const body = sent[0] as unknown as { to: string[]; subject: string; text: string };
  assert.deepEqual(body.to, ['owner@example.com']);
  assert.ok(body.subject.includes('每周复盘'));
  assert.ok(body.text.includes('[urgent] 回复差评'));
  assert.ok(body.text.includes('基于 42 条导入内容'));
  const patch = deliveryPatches.at(-1) as { status?: string; deliveredAt?: string } | undefined;
  assert.equal(patch?.status, 'delivered');
  assert.equal(typeof patch?.deliveredAt, 'string');
  assert.ok(auditEvents.includes('insight.delivered'));
  assert.ok(statements.some((sql) => sql.includes("UPDATE job SET status = 'succeeded'")));
});

test('insight.deliver skips safely when the snapshot is not approved', async () => {
  const statements: string[] = [];
  const auditEvents: unknown[] = [];
  const deliveryPatches: unknown[] = [];
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCalled = true; return new Response('{}', { status: 200 }); }) as typeof fetch;
  try {
    const worker = insightDeliveryWorker({ statements, auditEvents, deliveryPatches, delivery: { ...DELIVERY_SNAPSHOT, status: 'awaiting_approval' }, email: { apiKey: 'rk', from: 'f@example.com' } });
    await (worker as unknown as { deliverInsight: (job: ClaimedJob) => Promise<void> }).deliverInsight(deliveryJob());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalled, false);
  assert.equal(deliveryPatches.length, 0);
  assert.ok(statements.some((sql) => sql.includes("UPDATE job SET status = 'succeeded'")));
});

test('insight.deliver posts to Discord through the connected Zernio account', async () => {
  const statements: string[] = [];
  const auditEvents: unknown[] = [];
  const deliveryPatches: unknown[] = [];
  const executed: { key: string; action: Record<string, unknown> }[] = [];
  const worker = insightDeliveryWorker({
    statements, auditEvents, deliveryPatches,
    delivery: { ...DELIVERY_SNAPSHOT, channel: 'discord', target: 'acc-1', targetLabel: 'Piggy Discord' },
    zernio: { executeAction: async (key, action) => { executed.push({ key, action }); return { posted: true }; } },
  });
  await (worker as unknown as { deliverInsight: (job: ClaimedJob) => Promise<void> }).deliverInsight(deliveryJob());
  assert.equal(executed.length, 1);
  assert.equal(executed[0]?.key, 'insight-delivery:job-d1');
  const action = executed[0]?.action as { type: string; platform: string; accountId: string; content: string };
  assert.equal(action.type, 'social.create_post');
  assert.equal(action.platform, 'discord');
  assert.equal(action.accountId, 'ext-discord-1');
  assert.ok(action.content.length <= 1_900);
  assert.ok(auditEvents.includes('insight.delivered'));
});

test('insight.deliver dead-letters mark the delivery failed with an audit event', async () => {
  const statements: string[] = [];
  const auditEvents: unknown[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO audit_event')) auditEvents.push(values?.[1]);
      if (sql.includes('FROM insight_report')) {
        return { rows: [{ title: 'T', template: 'daily_ops', itemCount: 1, droppedCitations: 0, report: { summary: 's', tasks: [] }, delivery: DELIVERY_SNAPSHOT }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE job SET status')) {
        return { rows: [{ status: 'dead_lettered' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const worker = new RunWorker({
    workerName: 'delivery-test',
    database: {
      claimNextJob: async () => undefined,
      withWorkspace: async (_workspaceId, operation) => operation(tx),
    },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { throw new Error('unexpected'); },
      async generateInsightReport() { throw new Error('unexpected'); },
    },
    // 无 email 配置 → deliverInsight 抛错 → failJob → dead_lettered 分支。
  });
  const internals = worker as unknown as { deliverInsight: (job: ClaimedJob) => Promise<void>; failJob: (job: ClaimedJob, error: unknown) => Promise<void> };
  const job = deliveryJob({ attempt: 5 });
  try {
    await internals.deliverInsight(job);
    assert.fail('expected deliverInsight to throw when email is not configured');
  } catch (error) {
    await internals.failJob(job, error);
  }
  assert.ok(statements.some((sql) => sql.includes('UPDATE insight_report SET delivery = COALESCE')));
  assert.ok(auditEvents.includes('insight.delivery_failed'));
});

// ---------- 迭代 5：分类与洞察生成的 AI credits 计量 ----------

interface UsageMockOptions { aiCreditsUsed?: number }

/** usageSnapshot 的最小 mock：active 订阅 + 可控的已用额度。 */
function usageHandlers(options: UsageMockOptions) {
  return {
    match(sql: string): { rows: Record<string, unknown>[]; rowCount: number } | null {
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: options.aiCreditsUsed ?? 0, supplierSpendMicros: 0 }], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }], rowCount: 1 };
      return null;
    },
  };
}

test('import.classify reserves credits per chunk with an idempotent content-hash attempt', async () => {
  const usage = usageHandlers({});
  const statements: string[] = [];
  const chargeEvents: unknown[][] = [];
  let pendingCalls = 0;
  const items = [
    { id: 'item-1', text: 'where can I buy it', author: null, platform: 'instagram' },
    { id: 'item-2', text: 'love this', author: null, platform: 'rednote' },
  ];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      const usageRow = usage.match(sql);
      if (usageRow) return usageRow as { rows: Row[]; rowCount: number };
      if (sql.startsWith('INSERT INTO task_event')) chargeEvents.push([...(values ?? [])]);
      if (sql.includes("UPDATE import_batch SET status = 'classifying'")) return { rows: [{ status: 'classifying', modelBand: 'standard' }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('classified_at IS NULL')) {
        pendingCalls += 1;
        return { rows: (pendingCalls === 1 ? items : []) as unknown as Row[], rowCount: 0 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-c1', workspaceId: 'workspace-1', runId: null, kind: 'import.classify', payload: { batchId: 'batch-1' }, attempt: 1 }];
  let chargedBand: string | null = null;
  const worker = new RunWorker({
    workerName: 'meter-test',
    database: { claimNextJob: async () => jobs.shift(), withWorkspace: async (_id, op) => op(tx) },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems(payload) { chargedBand = (payload as { modelBand: string }).modelBand; return { assignments: [] }; },
      async generateInsightReport() { throw new Error('unexpected'); },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.equal(chargeEvents.length, 1);
  const event = chargeEvents[0]!;
  assert.equal(event[0], null); // run_id 可空
  assert.equal(event[1], 'batch-1'); // subject_id
  assert.equal(event[2], 6); // standard = 6 credits
  assert.equal(event[6], 'ai.classify'); // 稳定前缀幂等键
  assert.equal(event[7], 'standard'); // model_band 独立列
  assert.ok(Number(event[5]) >= 1); // 内容哈希 attempt
  assert.equal(chargedBand, 'standard');
});

test('import.classify replays the paid chunk reservation after an LLM failure on an empty balance', async () => {
  // 审核 #5：chunk 预扣最后额度后 LLM 失败 → 重试时余额为 0 —— 必须复用
  // 已付额度完成分类，而不是被暂停门禁延迟 6 小时。
  const items = [{ id: 'item-1', text: 'where can I buy it', author: null, platform: 'instagram' }];
  let taskEventCalls = 0;
  let pendingCalls = 0;
  const chargeEvents: unknown[][] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      // 第二次 runOne 起余额耗尽（首次扣了最后 6 点）。
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: taskEventCalls > 0 ? 400 : 394, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.startsWith('INSERT INTO task_event')) { taskEventCalls += 1; chargeEvents.push([...(values ?? [])]); return { rows: [{ id: 'evt-1' }] as unknown as Row[], rowCount: 1 }; }
      // 幂等回放查询：首轮无既有事件；重试轮命中首次写入的事件。
      if (sql.includes('FROM task_event')) {
        const replayed = taskEventCalls > 0;
        return { rows: (replayed ? [{ band: 'standard', provider: 'fallback', credits: 6, cost: 200_000 }] : []) as unknown as Row[], rowCount: 0 };
      }
      if (sql.includes("UPDATE import_batch SET status = 'classifying'")) return { rows: [{ status: 'classifying', modelBand: 'standard' }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('classified_at IS NULL')) {
        pendingCalls += 1;
        // 两次 runOne 各取一轮 pending；成功后第二轮 fetch 返回空结束。
        return { rows: (pendingCalls <= 2 ? items : []) as unknown as Row[], rowCount: 0 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  let capturedProvider: string | null = null;
  const job: ClaimedJob = { id: 'job-r1', workspaceId: 'workspace-1', runId: null, kind: 'import.classify', payload: { batchId: 'batch-1' }, attempt: 1 };

  // 第一次执行：扣费成功但 LLM 失败 → job 重试。
  const jobs1: ClaimedJob[] = [job];
  const w1 = new RunWorker({
    workerName: 'replay-test',
    database: { claimNextJob: async () => jobs1.shift(), withWorkspace: async (_id, op) => op(tx) },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { throw new Error('LLM provider timeout'); },
      async generateInsightReport() { throw new Error('unexpected'); },
    },
  });
  assert.equal(await w1.runOne(), true);
  assert.equal(chargeEvents.length, 1); // 首轮已扣费

  // 第二次执行：余额已耗尽，但幂等回放直接复用已付额度，分类照常完成。
  const jobs2: ClaimedJob[] = [{ ...job, attempt: 2 }];
  const w2 = new RunWorker({
    workerName: 'replay-test',
    database: { claimNextJob: async () => jobs2.shift(), withWorkspace: async (_id, op) => op(tx) },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems(payload) { capturedProvider = (payload as { provider: string }).provider; return { assignments: [{ itemIndex: 0, tags: [] }] }; },
      async generateInsightReport() { throw new Error('unexpected'); },
    },
  });
  assert.equal(await w2.runOne(), true);
  assert.equal(chargeEvents.length, 1); // 没有第二次扣费
  assert.equal(capturedProvider, 'fallback'); // 复用首次预订记录的供应商路由
});

test('import.classify defers instead of charging when credits are exhausted', async () => {
  const usage = usageHandlers({ aiCreditsUsed: 400 }); // creator 400 已用完
  const statements: string[] = [];
  const auditEvents: unknown[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      const usageRow = usage.match(sql);
      if (usageRow) return usageRow as { rows: Row[]; rowCount: number };
      if (sql.startsWith('INSERT INTO audit_event')) auditEvents.push(values?.[1]);
      if (sql.includes("UPDATE import_batch SET status = 'classifying'")) return { rows: [{ status: 'classifying', modelBand: 'eco' }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('classified_at IS NULL')) return { rows: [{ id: 'item-1', text: 'hello', author: null, platform: 'instagram' }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-c2', workspaceId: 'workspace-1', runId: null, kind: 'import.classify', payload: { batchId: 'batch-1' }, attempt: 1 }];
  let aiCalled = false;
  const worker = new RunWorker({
    workerName: 'meter-test',
    database: { claimNextJob: async () => jobs.shift(), withWorkspace: async (_id, op) => op(tx) },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { aiCalled = true; return { assignments: [] }; },
      async generateInsightReport() { throw new Error('unexpected'); },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.equal(aiCalled, false);
  assert.ok(auditEvents.includes('import.classify_deferred'));
  assert.ok(statements.some((sql) => sql.includes("interval '6 hours'")));
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO task_event')), false);
});

test('insight.generate reserves credits once per report and defers when exhausted', async () => {
  const usage = usageHandlers({ aiCreditsUsed: 400 });
  const statements: string[] = [];
  const auditEvents: unknown[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      const usageRow = usage.match(sql);
      if (usageRow) return usageRow as { rows: Row[]; rowCount: number };
      if (sql.startsWith('INSERT INTO audit_event')) auditEvents.push(values?.[1]);
      if (sql.includes("UPDATE insight_report SET status = 'generating'")) {
        return { rows: [{ template: 'content_recap', modelBand: 'eco', batchIds: ['batch-1'] }] as unknown as Row[], rowCount: 1 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-g1', workspaceId: 'workspace-1', runId: null, kind: 'insight.generate', payload: { reportId: 'report-1' }, attempt: 1 }];
  let aiCalled = false;
  const worker = new RunWorker({
    workerName: 'meter-test',
    database: { claimNextJob: async () => jobs.shift(), withWorkspace: async (_id, op) => op(tx) },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { throw new Error('unexpected'); },
      async generateInsightReport() { aiCalled = true; return {}; },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.equal(aiCalled, false);
  assert.ok(auditEvents.includes('insight.generate_deferred'));
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO task_event')), false);
});

test('import.classify requeues an incomplete chunk without shrinking the paid item set', async () => {
  const usage = usageHandlers({});
  const items = [
    { id: 'item-1', text: 'where can I buy it', author: null, platform: 'instagram' },
    { id: 'item-2', text: 'love this', author: null, platform: 'rednote' },
  ];
  const auditPayloads: Array<{ event: unknown; payload: unknown }> = [];
  const classifyCalls: number[] = [];
  let processed = false;
  const reservationKeys: unknown[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      if (sql.startsWith('INSERT INTO task_event')) reservationKeys.push(values?.[5]);
      if (sql.includes('UPDATE import_item SET classified_at')) processed = true;
      const usageRow = usage.match(sql);
      if (usageRow) return usageRow as { rows: Row[]; rowCount: number };
      if (sql.startsWith('INSERT INTO audit_event')) auditPayloads.push({ event: values?.[1], payload: values?.[2] });
      if (sql.includes("UPDATE import_batch SET status = 'classifying'")) return { rows: [{ status: 'classifying', modelBand: 'eco' }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('classified_at IS NULL')) {
        const rows = processed ? [] : items;
        return { rows: rows as unknown as Row[], rowCount: 0 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-c3', workspaceId: 'workspace-1', runId: null, kind: 'import.classify', payload: { batchId: 'batch-1' }, attempt: 1 }];
  const worker = new RunWorker({
    workerName: 'meter-test',
    database: { claimNextJob: async () => jobs.shift(), withWorkspace: async (_id, op) => op(tx) },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems(payload) {
        const payloadItems = (payload as { items: unknown[] }).items;
        classifyCalls.push(payloadItems.length);
        // 第一轮模型漏掉第 2 条（只返回 itemIndex 0）；第二轮补上了。
        return { assignments: classifyCalls.length === 1 ? [{ itemIndex: 0, tags: [] }] : [{ itemIndex: 0, tags: [] }, { itemIndex: 1, tags: [] }] };
      },
      async generateInsightReport() { throw new Error('unexpected'); },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.deepEqual(classifyCalls, [2]); // Next bounded job attempt retries the full chunk.
  assert.equal(processed, false);
  assert.ok(!auditPayloads.some((entry) => entry.event === 'import.classify_incomplete'));
  assert.ok(!auditPayloads.some((entry) => entry.event === 'import.classified'));
  jobs.push({ id: 'job-c3', workspaceId: 'workspace-1', runId: null, kind: 'import.classify', payload: { batchId: 'batch-1' }, attempt: 2 });
  await worker.runOne();
  assert.deepEqual(classifyCalls, [2, 2]);
  assert.equal(processed, true);
  assert.equal(reservationKeys.length, 2);
  assert.equal(reservationKeys[0], reservationKeys[1], 'partial responses must not change the idempotency key');
});

test('import.classify does not falsely complete a zero-progress result', async () => {
  const usage = usageHandlers({});
  const auditPayloads: Array<{ event: unknown; payload: unknown }> = [];
  let classifyCalls = 0;
  let pendingCalls = 0;
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      const usageRow = usage.match(sql);
      if (usageRow) return usageRow as { rows: Row[]; rowCount: number };
      if (sql.startsWith('INSERT INTO audit_event')) auditPayloads.push({ event: values?.[1], payload: values?.[2] });
      if (sql.includes("UPDATE import_batch SET status = 'classifying'")) return { rows: [{ status: 'classifying', modelBand: 'eco' }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('classified_at IS NULL')) {
        pendingCalls += 1;
        // 前两轮模型都不覆盖该条目；放弃标记后第三轮 fetch 返回空。
        const rows = pendingCalls <= 2 ? [{ id: 'item-1', text: 'stubborn item', author: null, platform: 'unknown' }] : [];
        return { rows: rows as unknown as Row[], rowCount: 0 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-c4', workspaceId: 'workspace-1', runId: null, kind: 'import.classify', payload: { batchId: 'batch-1' }, attempt: 1 }];
  const worker = new RunWorker({
    workerName: 'meter-test',
    database: { claimNextJob: async () => jobs.shift(), withWorkspace: async (_id, op) => op(tx) },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { classifyCalls += 1; return { assignments: [] }; }, // 模型持续漏处理
      async generateInsightReport() { throw new Error('unexpected'); },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.equal(classifyCalls, 1);
  assert.ok(!auditPayloads.some(entry => entry.event === 'import.classified'));
});

test('insight.generate fails the report when no conclusion is grounded in verbatim evidence', async () => {
  const usage = usageHandlers({});
  const auditPayloads: Array<{ event: unknown; payload: unknown }> = [];
  const failedErrors: string[] = [];
  let generated = false;
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      const usageRow = usage.match(sql);
      if (usageRow) return usageRow as { rows: Row[]; rowCount: number };
      if (sql.startsWith('INSERT INTO audit_event')) auditPayloads.push({ event: values?.[1], payload: values?.[2] });
      if (sql.includes("UPDATE insight_report SET status = 'generating'")) {
        return { rows: [{ template: 'comment_insights', modelBand: 'eco', batchIds: ['batch-1'] }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM import_item')) {
        return { rows: [{ id: 'aaaa-1', platform: 'youtube', author: null, text: 'take my money please', metrics: {}, tags: [] }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes("UPDATE insight_report") && sql.includes("'failed'")) { failedErrors.push(String(values?.[2])); }
      if (sql.includes("UPDATE insight_report") && sql.includes("'generated'")) { generated = true; }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const jobs: ClaimedJob[] = [{ id: 'job-g2', workspaceId: 'workspace-1', runId: null, kind: 'insight.generate', payload: { reportId: 'report-1' }, attempt: 1 }];
  const worker = new RunWorker({
    workerName: 'meter-test',
    database: { claimNextJob: async () => jobs.shift(), withWorkspace: async (_id, op) => op(tx) },
    aiRuntime: {
      async prepareAnnouncement() { throw new Error('unexpected'); },
      async getAnnouncementRun() { throw new Error('unexpected'); },
      async classifyItems() { throw new Error('unexpected'); },
      async generateInsightReport() {
        return {
          summary: 'Made-up conclusions.',
          frequentQuestions: [{ question: 'q?', approxCount: 5, citations: [{ ref: 'i9', snippet: 'not in the source' }] }],
          sentimentNotes: [],
          demandRanking: [{ demand: 'ghost', approxCount: 3, citations: [] }],
          productOpportunities: [],
          memeMaterial: [],
          highValueComments: [],
        };
      },
    },
  });

  assert.equal(await worker.runOne(), true);
  assert.equal(generated, false); // 空壳报告不得标记为 generated
  assert.ok(failedErrors[0]?.startsWith('insufficient_grounded_evidence'));
  assert.ok(auditPayloads.some((entry) => entry.event === 'insight.insufficient_evidence'));
  // 失败是终态：job 正常结束而不是重试烧额度。
  assert.ok(auditPayloads.every((entry) => entry.event !== 'insight.generate_deferred'));
});
