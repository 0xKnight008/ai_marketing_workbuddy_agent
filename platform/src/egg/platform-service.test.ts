import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActorContext } from '../contracts/domain';
import type { Database } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import type { PlatformOrm } from '../foundation/sequelize';
import { PlatformService } from './platform-service';

test('pending approvals use the tenant-scoped Sequelize repository', async () => {
  const actor: ActorContext = { actorId: 'actor-1', workspaceId: 'workspace-1', role: 'approver' };
  const expected = [{ id: 'approval-1', runId: 'run-1', requestedAction: {}, requestedAt: new Date() }];
  let receivedWorkspace: string | undefined;
  const orm = {
    async pendingApprovals(workspaceId: string) {
      receivedWorkspace = workspaceId;
      return expected;
    },
  } as unknown as PlatformOrm;
  const service = new PlatformService({} as GatewayConfig, {} as Database, orm);

  assert.deepEqual(await service.pendingApprovals(actor), expected);
  assert.equal(receivedWorkspace, actor.workspaceId);
});

test('platform feedback derives the sender email from the authenticated workspace', async () => {
  const actor: ActorContext = { actorId: 'actor-1', workspaceId: 'workspace-1', role: 'owner' };
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const database = {
    async withWorkspace(_workspaceId: string, operation: (tx: { query: <Row>(sql: string, values?: readonly unknown[]) => Promise<{ rows: Row[]; rowCount: number }> }) => Promise<unknown>) {
      return operation({
        async query<Row>(sql: string, values?: readonly unknown[]) {
          queries.push({ sql, values });
          if (sql.includes('FROM app_user')) return { rows: [{ email: 'member@example.com' } as Row], rowCount: 1 };
          return { rows: [], rowCount: 1 };
        },
      });
    },
  } as unknown as Database;
  const service = new PlatformService({} as GatewayConfig, database, {} as PlatformOrm);

  const result = await service.createFeedback(actor, { category: 'bug', message: '<b>Cannot</b> save\nworkflow', locale: 'en' });

  assert.match(result.ticketId, /^FB-[0-9A-F]{8}$/);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1]?.values?.slice(1, 7), ['workspace-1', 'member@example.com', undefined, 'bug', 'Cannot save workflow', 'en']);
});
