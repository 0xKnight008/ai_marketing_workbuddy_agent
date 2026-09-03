import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActorContext } from '../contracts/domain';
import type { Database, TenantTransaction } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { HttpError } from '../http/errors';
import { AdminService } from './service';

const actor: ActorContext = {
  actorId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  role: 'owner',
};
const targetWorkspaceId = '33333333-3333-4333-8333-333333333333';
const adminToken = 'platform-admin-secret-at-least-32-characters';
const config = { BILLING_ADMIN_TOKEN: adminToken } as GatewayConfig;

test('admin access requires both a privileged session and the private secret', async () => {
  const database = { withAdmin() { throw new Error('database should not be reached'); } } as unknown as Database;
  const service = new AdminService(config, database);

  await assert.rejects(
    service.feedback({ ...actor, role: 'editor' }, adminToken, {}),
    (error: unknown) => error instanceof HttpError && error.code === 'platform_admin_required',
  );
  await assert.rejects(
    service.feedback(actor, 'incorrect-secret', {}),
    (error: unknown) => error instanceof HttpError && error.code === 'platform_admin_required',
  );
});

test('workspace inventory keeps billing and usage reads inside tenant RLS transactions', async () => {
  const scoped: string[] = [];
  const database = {
    async withAdmin(operation: (tx: TenantTransaction) => Promise<unknown>) {
      return operation(txFor((sql) => {
        assert.match(sql, /FROM workspace w/);
        return [{ id: targetWorkspaceId, name: 'Acme', slug: 'acme', ownerEmail: 'owner@example.com', createdAt: '2026-09-01T00:00:00Z' }];
      }));
    },
    async withWorkspace(workspaceId: string, operation: (tx: TenantTransaction) => Promise<unknown>) {
      scoped.push(workspaceId);
      return operation(txFor((sql) => {
        if (sql.includes('INSERT INTO workspace_billing')) return [{ plan: 'growth', purchasedCredits: '2000', subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null }];
        if (sql.includes('FROM task_event')) return [{ taskUsed: '12', aiCreditsUsed: '3', supplierSpendMicros: '1000' }];
        if (sql.includes('FROM connected_account')) return [{ connectedAccounts: '0' }];
        return [];
      }));
    },
  } as unknown as Database;

  const rows = await new AdminService(config, database).workspaces(actor, adminToken, { q: 'Acme' });

  assert.deepEqual(scoped, [targetWorkspaceId]);
  assert.equal(rows[0]?.usage.plan, 'growth');
  assert.equal(rows[0]?.usage.taskUsed, 12);
  assert.equal(rows[0]?.usage.subscriptionStatus, 'active');
});

test('dead-letter replay resets the attempt lease, revives its run, and writes an audit event', async () => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const jobId = '44444444-4444-4444-8444-444444444444';
  const runId = '55555555-5555-4555-8555-555555555555';
  const database = scopedDatabase(targetWorkspaceId, (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('UPDATE job')) return [{ id: jobId, runId }];
    return [];
  });

  const result = await new AdminService(config, database).replayJob(actor, adminToken, jobId, { workspaceId: targetWorkspaceId });

  assert.deepEqual(result, { id: jobId, status: 'queued' });
  assert.match(queries[0]?.sql ?? '', /attempt = 0/);
  assert.ok(queries.some(({ sql }) => sql.includes("UPDATE workflow_run SET status = 'queued'")));
  assert.ok(queries.some(({ sql, values }) => sql.includes('INSERT INTO audit_event') && values?.[2] === 'admin.job_replayed'));
});

test('support status transitions use the global inbox and audit the affected workspace', async () => {
  const globalQueries: string[] = [];
  const scopedQueries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const database = {
    async withAdmin(operation: (tx: TenantTransaction) => Promise<unknown>) {
      return operation(txFor((sql) => {
        globalQueries.push(sql);
        if (sql.includes('SELECT workspace_id')) return [{ workspaceId: targetWorkspaceId }];
        return [];
      }));
    },
    async withWorkspace(workspaceId: string, operation: (tx: TenantTransaction) => Promise<unknown>) {
      assert.equal(workspaceId, targetWorkspaceId);
      return operation(txFor((sql, values) => {
        scopedQueries.push({ sql, values });
        if (!sql.includes('UPDATE feedback_message')) return [];
        return [{
          id: '66666666-6666-4666-8666-666666666666', ticketNo: 'FB-A1B2C3D4', workspaceId: targetWorkspaceId,
          workspaceName: null, email: 'owner@example.com', name: null, category: 'bug', message: 'Broken', status: 'closed',
          discordThreadId: null, repliedBy: null, createdAt: '2026-09-01T00:00:00Z', repliedAt: null,
        }];
      }));
    },
  } as unknown as Database;

  const result = await new AdminService(config, database).updateFeedback(actor, adminToken, 'FB-A1B2C3D4', { status: 'closed' });

  assert.equal(result.status, 'closed');
  assert.match(globalQueries[0] ?? '', /SELECT workspace_id/);
  assert.match(scopedQueries[0]?.sql ?? '', /UPDATE feedback_message/);
  assert.equal(scopedQueries[1]?.values?.[2], 'admin.feedback_status_changed');
});

test('pending referral credits can be voided only inside their owning workspace', async () => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const ledgerId = '77777777-7777-4777-8777-777777777777';
  const database = scopedDatabase(targetWorkspaceId, (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('FROM referral_credit_ledger')) return [{ stripeInvoiceId: 'in_123', status: 'pending' }];
    return [];
  });

  const result = await new AdminService(config, database).voidReferral(actor, adminToken, ledgerId, { workspaceId: targetWorkspaceId });

  assert.deepEqual(result, { id: ledgerId, status: 'void' });
  assert.ok(queries.some(({ sql }) => sql.includes("SET status = 'void'")));
  assert.ok(queries.some(({ sql }) => sql.includes("status IN ('queued', 'dead_lettered')")));
  assert.ok(queries.some(({ values }) => values?.[2] === 'admin.referral_credit_reversed'));
});

function scopedDatabase(
  expectedWorkspaceId: string,
  responder: (sql: string, values?: readonly unknown[]) => unknown[],
): Database {
  return {
    async withWorkspace(workspaceId: string, operation: (tx: TenantTransaction) => Promise<unknown>) {
      assert.equal(workspaceId, expectedWorkspaceId);
      return operation(txFor(responder));
    },
  } as unknown as Database;
}

function txFor(responder: (sql: string, values?: readonly unknown[]) => unknown[]): TenantTransaction {
  return {
    async query<Row>(sql: string, values?: readonly unknown[]) {
      const rows = responder(sql, values) as Row[];
      return { rows, rowCount: rows.length };
    },
  };
}
