import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActorContext } from '../contracts/domain';
import type { Database } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import type { PlatformOrm } from '../foundation/sequelize';
import { PlatformService } from './platform-service';
import supportRepliesSchedule from '../../app/schedule/support-replies';
import type { Context } from 'egg';

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

test('platform feedback persists the created Discord thread for email delivery', async (t) => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const query = async <Row>(sql: string, values?: readonly unknown[]) => {
    queries.push({ sql, values });
    return { rows: sql.includes('FROM app_user') ? [{ email: 'member@example.com' } as Row] : [], rowCount: 1 };
  };
  const database = {
    withWorkspace: async (_id: string, operation: (tx: { query: typeof query }) => Promise<unknown>) => operation({ query }),
    withAdmin: async (operation: (tx: { query: typeof query }) => Promise<unknown>) => operation({ query }),
  } as unknown as Database;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push(url);
    if (url.endsWith('/messages')) assert.deepEqual(JSON.parse(String(options.body)).allowed_mentions, { parse: [] });
    return Response.json({ id: url.endsWith('/threads') ? '200' : '100' });
  });
  const service = new PlatformService({ DISCORD_BOT_TOKEN: 'test', DISCORD_FEEDBACK_CHANNEL_ID: '1' } as GatewayConfig, database, {} as PlatformOrm);
  const result = await service.createFeedback({ actorId: 'actor-1', workspaceId: 'workspace-1', role: 'owner' }, { message: 'Help' });
  assert.equal(calls.length, 2);
  assert.match(calls[1]!, /messages\/100\/threads$/);
  const mapping = queries.find((item) => item.sql.includes('SET discord_thread_id'));
  assert.deepEqual(mapping?.values, [result.ticketId, '200']);
});

test('Egg schedule polls support replies using the platform database without a public API process', async () => {
  const queries: string[] = [];
  const database = {
    withAdmin: async (operation: (tx: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => operation({ query: async (sql) => { queries.push(sql); return { rows: [] }; } }),
  } as unknown as Database;
  const config = { DISCORD_BOT_TOKEN: 'test', DISCORD_FEEDBACK_CHANNEL_ID: '1', RESEND_API_KEY: 'test', RESEND_FROM_EMAIL: 'support@example.com' } as GatewayConfig;
  const service = new PlatformService(config, database, {} as PlatformOrm);
  const ctx = { app: { config: { env: 'prod' }, platform: { service } } } as unknown as Context;
  await supportRepliesSchedule.task(ctx);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /discord_thread_id/);
  config.DISCORD_REPLY_DELIVERY_ENABLED = 'false';
  await supportRepliesSchedule.task(ctx);
  assert.equal(queries.length, 1);
});
