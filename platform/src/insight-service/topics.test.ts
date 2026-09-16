import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';

import type { ActorContext } from '../contracts/domain';
import type { Database, TenantTransaction } from '../foundation/database';
import { HttpError } from '../http/errors';
import { TopicService } from './topics';

const actor: ActorContext = { actorId: 'user-1', workspaceId: 'workspace-1', role: 'owner' };

interface MockOptions {
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
  creditsExhausted?: boolean;
  activeRun?: boolean;
  classifiedItems?: number;
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
      // runView（创建后的回读）：与活跃运行检查区分于 model_band 投影。
      if (sql.includes('FROM topic_run') && sql.includes('model_band AS "modelBand"')) {
        return { rows: [{
          id: 'run-1', status: 'pending', modelBand: 'eco', itemCount: options.classifiedItems ?? 12,
          topicCount: 0, error: null, createdAt: new Date().toISOString(), completedAt: null,
        }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM topic_run')) {
        return { rows: options.activeRun ? [{ id: 'run-active' }] as unknown as Row[] : [] as Row[], rowCount: 1 };
      }
      if (sql.includes('COUNT(*)::text AS count FROM import_item')) {
        return { rows: [{ count: String(options.classifiedItems ?? 12) }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO topic_run')) {
        return { rows: [{ id: 'run-1' }] as unknown as Row[], rowCount: 1 };
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

test('startTopicRun rejects unpaid workspaces with 402', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'inactive' });
  const service = new TopicService(database);
  await assert.rejects(
    () => service.startTopicRun(actor, {}),
    (error) => error instanceof HttpError && error.statusCode === 402,
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO topic_run')), false);
});

test('startTopicRun rejects when credits are exhausted', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active', creditsExhausted: true });
  const service = new TopicService(database);
  await assert.rejects(
    () => service.startTopicRun(actor, {}),
    (error) => error instanceof HttpError && error.statusCode === 402 && error.message === 'ai_credits_exhausted',
  );
});

test('startTopicRun allows only one active run per workspace (409)', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', activeRun: true });
  const service = new TopicService(database);
  await assert.rejects(
    () => service.startTopicRun(actor, {}),
    (error) => error instanceof HttpError && error.statusCode === 409 && error.message === 'topic_run_already_active',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO topic_run')), false);
});

test('startTopicRun requires classified items', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active', classifiedItems: 0 });
  const service = new TopicService(database);
  await assert.rejects(
    () => service.startTopicRun(actor, {}),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'topics_no_classified_items',
  );
});

test('startTopicRun enqueues topics.cluster and audits creation', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 86_400_000).toISOString() });
  const service = new TopicService(database);
  const view = await service.startTopicRun(actor, { modelBand: 'standard' });
  assert.equal(view.id, 'run-1');
  assert.equal(view.status, 'pending');
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO job') && sql.includes('topics.cluster')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO audit_event') || sql.includes('topics.run_created')));
});

test('startTopicRun requires workflow:run permission (viewers rejected)', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active' });
  const service = new TopicService(database);
  const viewer: ActorContext = { actorId: 'user-2', workspaceId: 'workspace-1', role: 'viewer' as ActorContext['role'] };
  await assert.rejects(() => service.startTopicRun(viewer, {}));
});
