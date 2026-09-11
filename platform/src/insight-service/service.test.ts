import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';

import type { ActorContext } from '../contracts/domain';
import type { Database, TenantTransaction } from '../foundation/database';
import { HttpError } from '../http/errors';
import { InsightService } from './service';

const actor: ActorContext = { actorId: 'user-1', workspaceId: 'workspace-1', role: 'owner' };

interface MockOptions {
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
  classifiedBatchIds?: string[];
  itemCount?: number;
  creditsExhausted?: boolean;
}

function mockDatabase(options: MockOptions = {}) {
  const statements: string[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.includes('FROM workspace_billing')) {
        if (options.subscriptionStatus === undefined) return { rows: [] as Row[], rowCount: 0 };
        return { rows: [{ status: options.subscriptionStatus, trialEndsAt: options.trialEndsAt ?? null }] as unknown as Row[], rowCount: 1 };
      }
      // usageSnapshot（迭代 5 额度门禁）的四条查询。
      if (sql.includes('RETURNING plan')) {
        return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: options.subscriptionStatus ?? 'active', trialEndsAt: options.trialEndsAt ?? null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('AS "taskUsed"')) {
        return { rows: [{ taskUsed: 0, aiCreditsUsed: options.creditsExhausted ? 400 : 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "trialCreditsUsed"')) return { rows: [{ trialCreditsUsed: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('FROM import_batch')) {
        return { rows: (options.classifiedBatchIds ?? ['batch-1']).map((id) => ({ id })) as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('COUNT(*)::text AS count FROM import_item')) {
        return { rows: [{ count: String(options.itemCount ?? 12) }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO insight_report')) {
        return { rows: [{ id: 'report-1' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM insight_report')) {
        return { rows: [{
          id: 'report-1', template: 'comment_insights', title: 'T', status: 'pending', modelBand: 'eco',
          batchIds: options.classifiedBatchIds ?? ['batch-1'], itemCount: 12, droppedCitations: 0,
          error: null, createdAt: new Date().toISOString(), generatedAt: null, report: null,
        }] as unknown as Row[], rowCount: 1 };
      }
      void values;
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const database = {
    withWorkspace: async <T>(_workspaceId: string, operation: (inner: TenantTransaction) => Promise<T>) => operation(tx),
  } as Database;
  return { database, statements };
}

test('createInsight rejects unpaid workspaces with 402', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'inactive' });
  const service = new InsightService(database);
  await assert.rejects(
    () => service.createInsight(actor, { template: 'content_recap' }),
    (error) => error instanceof HttpError && error.statusCode === 402,
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO insight_report')), false);
});

test('createInsight requires classified batches', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active', classifiedBatchIds: [] });
  const service = new InsightService(database);
  await assert.rejects(
    () => service.createInsight(actor, { template: 'comment_insights' }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'insight_no_classified_batches',
  );
});

test('createInsight rejects explicitly selected batches that are not all classified', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active', classifiedBatchIds: ['batch-1'] });
  const service = new InsightService(database);
  await assert.rejects(
    () => service.createInsight(actor, { template: 'content_recap', batchIds: [crypto.randomUUID(), crypto.randomUUID()] }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'insight_batches_not_ready',
  );
});

test('createInsight enqueues insight.generate and audits creation', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 86_400_000).toISOString() });
  const service = new InsightService(database);
  const view = await service.createInsight(actor, { template: 'product_opportunities', modelBand: 'standard' });
  assert.equal(view.id, 'report-1');
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO job') && sql.includes('insight.generate')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO audit_event')));
});

test('createInsight rejects unknown templates at schema level', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active' });
  const service = new InsightService(database);
  await assert.rejects(() => service.createInsight(actor, { template: 'weekly_recap' }));
});

test('createInsight daily_ops works from prior reports alone (no classified batches)', async () => {
  const statements: string[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.includes('FROM workspace_billing')) return { rows: [{ status: 'active', trialEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('FROM import_batch')) return { rows: [] as Row[], rowCount: 0 };
      if (sql.includes("status = 'generated'")) return { rows: [{ id: 'old-report' }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('COUNT(*)::text AS count FROM import_item')) return { rows: [{ count: '0' }] as unknown as Row[], rowCount: 1 };
      if (sql.startsWith('INSERT INTO insight_report')) return { rows: [{ id: 'report-daily' }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('FROM insight_report')) {
        return { rows: [{ id: 'report-daily', template: 'daily_ops', title: 'T', status: 'pending', modelBand: 'eco', batchIds: [], itemCount: 0, droppedCitations: 0, error: null, createdAt: new Date().toISOString(), generatedAt: null, report: null }] as unknown as Row[], rowCount: 1 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const database = { withWorkspace: async <T>(_id: string, op: (inner: TenantTransaction) => Promise<T>) => op(tx) } as Database;
  const service = new InsightService(database);
  const view = await service.createInsight(actor, { template: 'daily_ops' });
  assert.equal(view.id, 'report-daily');
  assert.ok(statements.some((sql) => sql.includes('insight.generate')));
});

test('createInsight daily_ops still requires at least one prior report when no batches exist', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active', classifiedBatchIds: [] });
  // mockDatabase 的默认 insight_report 查询会返回行，这里换成“无既有报告”的版本：
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string): Promise<{ rows: Row[]; rowCount: number }> {
      if (sql.includes('FROM workspace_billing')) return { rows: [{ status: 'active', trialEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "taskUsed"')) return { rows: [{ taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as Row[], rowCount: 0 };
    },
  } as TenantTransaction;
  const bareDatabase = { withWorkspace: async <T>(_id: string, op: (inner: TenantTransaction) => Promise<T>) => op(tx) } as Database;
  void database;
  const service = new InsightService(bareDatabase);
  await assert.rejects(
    () => service.createInsight(actor, { template: 'daily_ops' }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'insight_no_classified_batches',
  );
});

// ---------- 迭代 4：报告外发闭环（requestDelivery） ----------

interface DeliveryMockOptions {
  reportStatus?: string;
  delivery?: unknown;
  ownerEmail?: string | null;
  discordAccount?: { displayName: string; status: string; platform: string; capabilities: string[] } | null;
}

function mockDeliveryDatabase(options: DeliveryMockOptions = {}) {
  const statements: string[] = [];
  const auditEvents: unknown[] = [];
  let storedDelivery: unknown = options.delivery ?? {};
  const reportView = () => ({
    id: '11111111-1111-4111-8111-111111111111', template: 'content_recap', title: 'T', status: 'generated', modelBand: 'eco',
    batchIds: ['batch-1'], itemCount: 12, droppedCitations: 0,
    error: null, createdAt: new Date().toISOString(), generatedAt: new Date().toISOString(), report: { summary: 's' },
    delivery: storedDelivery,
  });
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO audit_event')) auditEvents.push(values?.[2]);
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ title: 'T', status: options.reportStatus ?? 'generated', delivery: options.delivery ?? {} }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM workspace_membership')) {
        return { rows: (options.ownerEmail === null ? [] : [{ email: options.ownerEmail ?? 'owner@example.com' }]) as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM connected_account')) {
        const account = options.discordAccount === undefined
          ? { displayName: 'Piggy Discord', status: 'connected', platform: 'discord', capabilities: ['publish'] }
          : options.discordAccount;
        return { rows: (account ? [account] : []) as unknown as Row[], rowCount: account ? 1 : 0 };
      }
      if (sql.startsWith('INSERT INTO approval_request')) {
        return { rows: [{ id: '22222222-2222-4222-8222-222222222222' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE insight_report SET delivery')) {
        storedDelivery = JSON.parse(String(values?.[1]));
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM insight_report')) {
        return { rows: [reportView()] as unknown as Row[], rowCount: 1 };
      }
      return { rows: [] as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const database = { withWorkspace: async <T>(_id: string, op: (inner: TenantTransaction) => Promise<T>) => op(tx) } as Database;
  return { database, statements, auditEvents };
}

test('requestDelivery defaults the email target to the workspace owner and creates a pending approval', async () => {
  const { database, statements, auditEvents } = mockDeliveryDatabase();
  const service = new InsightService(database);
  const view = await service.requestDelivery(actor, '11111111-1111-4111-8111-111111111111', { channel: 'email' });
  assert.equal(view.delivery?.status, 'awaiting_approval');
  assert.equal(view.delivery?.target, 'owner@example.com');
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO approval_request')));
  assert.ok(auditEvents.includes('insight.delivery_requested'));
});

test('requestDelivery uses an explicit email when provided', async () => {
  const { database } = mockDeliveryDatabase();
  const service = new InsightService(database);
  const view = await service.requestDelivery(actor, '11111111-1111-4111-8111-111111111111', { channel: 'email', email: 'Team@Example.com' });
  assert.equal(view.delivery?.target, 'team@example.com');
});

test('requestDelivery rejects reports that are not generated yet', async () => {
  const { database } = mockDeliveryDatabase({ reportStatus: 'generating' });
  const service = new InsightService(database);
  await assert.rejects(
    () => service.requestDelivery(actor, '11111111-1111-4111-8111-111111111111', { channel: 'email' }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'insight_not_generated',
  );
});

test('requestDelivery rejects a second request while one is awaiting approval', async () => {
  const { database } = mockDeliveryDatabase({
    delivery: {
      status: 'awaiting_approval', channel: 'email', target: 'owner@example.com', targetLabel: 'owner@example.com',
      approvalId: '22222222-2222-4222-8222-222222222222', requestedBy: 'user-1', requestedAt: new Date().toISOString(),
    },
  });
  const service = new InsightService(database);
  await assert.rejects(
    () => service.requestDelivery(actor, '11111111-1111-4111-8111-111111111111', { channel: 'email' }),
    (error) => error instanceof HttpError && error.statusCode === 409 && error.message === 'insight_delivery_pending',
  );
});

test('requestDelivery validates the Discord account platform, status and publish capability', async () => {
  const { database } = mockDeliveryDatabase({ discordAccount: { displayName: 'X', status: 'connected', platform: 'x', capabilities: ['publish'] } });
  const service = new InsightService(database);
  await assert.rejects(
    () => service.requestDelivery(actor, '11111111-1111-4111-8111-111111111111', { channel: 'discord', connectedAccountId: '33333333-3333-4333-8333-333333333333' }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'insight_delivery_target_invalid',
  );
});

test('requestDelivery snapshots a valid Discord account as the delivery target', async () => {
  const { database } = mockDeliveryDatabase();
  const service = new InsightService(database);
  const view = await service.requestDelivery(actor, '11111111-1111-4111-8111-111111111111', { channel: 'discord', connectedAccountId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(view.delivery?.status, 'awaiting_approval');
  assert.equal(view.delivery?.target, '33333333-3333-4333-8333-333333333333');
  assert.equal(view.delivery?.targetLabel, 'Piggy Discord');
});

test('requestDelivery fails when no owner email exists and none was provided', async () => {
  const { database } = mockDeliveryDatabase({ ownerEmail: null });
  const service = new InsightService(database);
  await assert.rejects(
    () => service.requestDelivery(actor, '11111111-1111-4111-8111-111111111111', { channel: 'email' }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'insight_delivery_target_missing',
  );
});

test('createInsight rejects with ai_credits_exhausted when the balance is empty', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', creditsExhausted: true });
  const service = new InsightService(database);
  await assert.rejects(
    () => service.createInsight(actor, { template: 'content_recap' }),
    (error) => error instanceof HttpError && error.statusCode === 402 && error.message === 'ai_credits_exhausted',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO insight_report')), false);
});
