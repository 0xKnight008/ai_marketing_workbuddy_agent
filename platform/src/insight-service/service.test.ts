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
  const { database, statements } = mockDatabase({ subscriptionStatus: 'trialing' });
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
