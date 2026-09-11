import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';

import type { ActorContext } from '../contracts/domain';
import type { Database, TenantTransaction } from '../foundation/database';
import { HttpError } from '../http/errors';
import { ImportService } from './service';

const actor: ActorContext = { actorId: 'user-1', workspaceId: 'workspace-1', role: 'owner' };

interface MockOptions { subscriptionStatus?: string; trialEndsAt?: string | null; creditsExhausted?: boolean }

function mockDatabase(options: MockOptions = {}) {
  const statements: string[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, _values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
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
      if (sql.startsWith('INSERT INTO import_batch')) {
        return { rows: [{ id: 'batch-1', createdAt: new Date().toISOString() }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM import_batch')) {
        return { rows: [{ id: 'batch-1', label: 'L', sourceType: 'paste', status: 'pending', modelBand: 'eco', itemCount: 2, createdAt: new Date().toISOString(), classifiedAt: null }] as unknown as Row[], rowCount: 1 };
      }
      return { rows: [] as unknown as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const database = {
    withWorkspace: async <T>(_workspaceId: string, operation: (inner: TenantTransaction) => Promise<T>) => operation(tx),
  } as Database;
  return { database, statements };
}

test('createImport rejects unpaid workspaces with 402 before inserting anything', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'inactive' });
  const service = new ImportService(database);
  await assert.rejects(
    () => service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: 'hello' }),
    (error) => error instanceof HttpError && error.statusCode === 402 && error.message === 'subscription_required',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO import_batch')), false);
});

test('createImport accepts trialing workspaces and enqueues classification', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 86_400_000).toISOString() });
  const service = new ImportService(database);
  const view = await service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: 'one\ntwo' });
  assert.equal(view.id, 'batch-1');
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO job") && sql.includes('import.classify')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO import_item')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO audit_event')));
});

test('createImport treats an unexpired trial window as paid', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'inactive', trialEndsAt: new Date(Date.now() + 60_000).toISOString() });
  const service = new ImportService(database);
  const view = await service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: 'one' });
  assert.equal(view.id, 'batch-1');
});

test('createImport rejects empty parses and oversized batches with 422', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active' });
  const service = new ImportService(database);
  await assert.rejects(
    () => service.createImport(actor, { label: 'Batch', sourceType: 'csv', content: 'text\n\n\n' }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'import_no_items',
  );
  const huge = Array.from({ length: 5_001 }, (_, index) => `line ${index}`).join('\n');
  await assert.rejects(
    () => service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: huge }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'import_too_large',
  );
});

test('createImport rejects with ai_credits_exhausted when the balance is empty', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', creditsExhausted: true });
  const service = new ImportService(database);
  await assert.rejects(
    () => service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: 'one\ntwo' }),
    (error) => error instanceof HttpError && error.statusCode === 402 && error.message === 'ai_credits_exhausted',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO import_batch')), false);
});
