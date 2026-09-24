import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationContentError } from './notification-limits';
import { RunWorker } from '../run-service/worker-runner';
import type { TenantTransaction } from '../foundation/database';

test('frozen notification size boundaries are explicit for both channels', () => {
  assert.equal(notificationContentError('discord', 'x'.repeat(1900)), null);
  assert.match(notificationContentError('discord', 'x'.repeat(1901))!, /use_email/);
  assert.equal(notificationContentError('email', 'x'.repeat(12000)), null);
  assert.match(notificationContentError('email', 'x'.repeat(12001))!, /too_long/);
});

for (const length of [1900, 1901]) test(`worker preserves exact Discord text or rejects legacy oversize (${length})`, async () => {
  const content = 'x'.repeat(length);
  const statements: string[] = [];
  const tx = { query: async (sql: string) => {
    statements.push(sql);
    if (sql.includes('FROM notification_event')) return { rows: [{ kind: 'weekly_report', status: 'queued', channel: 'discord', target: 'account', subject: 'subject', content }], rowCount: 1 };
    if (sql.includes('FROM connected_account')) return { rows: [{ id: 'account', workspaceId: 'workspace', status: 'connected', capabilities: ['publish'], externalAccountId: 'external' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } } as unknown as TenantTransaction;
  const sent: unknown[] = [];
  const worker = new RunWorker({ workerName: 'limit-test', database: {
    withWorkspace: async (_id, fn) => fn(tx),
    claimNextJob: async () => ({ id: 'job', workspaceId: 'workspace', runId: null, attempt: 1, kind: 'notification.send', payload: { eventId: '11111111-1111-4111-8111-111111111111' } }),
  }, aiRuntime: {
    prepareAnnouncement: async () => { throw new Error('unexpected'); }, getAnnouncementRun: async () => { throw new Error('unexpected'); },
    classifyItems: async () => { throw new Error('unexpected'); }, generateInsightReport: async () => { throw new Error('unexpected'); },
  }, zernio: { executeAction: async (_key, action) => { sent.push(action.content); } } });
  await worker.runOne();
  assert.deepEqual(sent, length === 1900 ? [content] : []);
  assert.equal(statements.some(sql => sql.includes("notification_event SET status = 'failed'")), length > 1900);
  assert.ok(statements.some(sql => sql.includes("UPDATE job SET status = 'succeeded'")));
});
