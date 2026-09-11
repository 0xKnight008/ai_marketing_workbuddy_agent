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
        return { rows: [] as Row[], rowCount: 1 };
      }
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
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE job SET status')) {
        return { rows: [{ status: 'queued' }] as unknown as Row[], rowCount: 1 };
      }
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
