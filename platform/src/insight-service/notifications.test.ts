import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, TenantTransaction } from '../foundation/database';
import { NotificationService, ScheduledNotificationService } from './notifications';

type QueryHandler = (sql: string, values: unknown[]) => { rows: unknown[]; rowCount: number };

function mockDatabase(handler: QueryHandler, statements: Array<{ sql: string; values: unknown[] }> = []) {
  const database = {
    withWorkspace: async <T>(workspace: string, operation: (tx: TenantTransaction) => Promise<T>) =>
      operation({ query: async (sql: string, values: unknown[]) => { statements.push({ sql, values }); return handler(sql, values); } } as unknown as TenantTransaction),
    withAdmin: async <T>(operation: (tx: TenantTransaction) => Promise<T>) =>
      operation({ query: async (sql: string, values: unknown[]) => { statements.push({ sql, values }); return handler(sql, values); } } as unknown as TenantTransaction),
  };
  return database as unknown as Database;
}

const owner = { workspaceId: 'workspace-1', actorId: 'user-1', role: 'owner' as const };
const viewer = { ...owner, role: 'viewer' as const };

test('putRule validates target shape and weekly config, then upserts with audit', async () => {
  const service = new NotificationService(mockDatabase(() => ({ rows: [], rowCount: 0 })));
  await assert.rejects(service.putRule(viewer, 'morning_push', { channel: 'email' }), /Forbidden: viewer lacks workflow:run/);
  await assert.rejects(service.putRule(owner, 'morning_push', { channel: 'discord' }), { statusCode: 422, code: 'notification_rule_target_invalid' });
  await assert.rejects(service.putRule(owner, 'morning_push', { channel: 'email', connectedAccountId: crypto.randomUUID() }), { statusCode: 422, code: 'notification_rule_target_conflict' });
  await assert.rejects(service.putRule(owner, 'weekly_report', { channel: 'email' }), { statusCode: 422, code: 'notification_weekly_config_required' });

  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const ok = new NotificationService(mockDatabase((sql) => {
    if (sql.includes('INSERT INTO notification_rule')) return { rows: [{ id: 'rule-1', updated_at: '2026-09-17T00:00:00.000Z' }], rowCount: 1 };
    if (sql.includes('INSERT INTO audit_event')) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql}`);
  }, statements));
  const saved = await ok.putRule(owner, 'weekly_report', { channel: 'email', weeklyTemplate: 'content_recap', weeklyDeliveryMode: 'approval' }) as { id: string };
  assert.equal(saved.id, 'rule-1');
  assert.ok(statements.some(entry => entry.sql.includes('ON CONFLICT (workspace_id, kind) DO UPDATE')));
  assert.ok(statements.some(entry => entry.values[2] === 'notification.rule_saved'));
});

test('approveEvent only releases pending weekly digests; actOnEvent closes the urgent loop', async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  let updatable = true;
  const service = new NotificationService(mockDatabase((sql) => {
    if (sql.includes("SET status = 'queued'")) return updatable ? { rows: [{ id: 'event-1' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO job')) return { rows: [], rowCount: 1 };
    if (sql.includes('INSERT INTO audit_event')) return { rows: [], rowCount: 1 };
    if (sql.includes('acted_at = now()')) return { rows: [{ id: 'event-2' }], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql}`);
  }, statements));
  const approved = await service.approveEvent(owner, crypto.randomUUID()) as { status: string };
  assert.equal(approved.status, 'queued');
  assert.ok(statements.some(entry => entry.sql.includes("'notification.send'")));
  updatable = false;
  await assert.rejects(service.approveEvent(owner, crypto.randomUUID()), { statusCode: 409, code: 'notification_event_not_approvable' });

  const acknowledged = await service.actOnEvent(owner, crypto.randomUUID(), { action: 'acknowledge' }) as { status: string };
  assert.equal(acknowledged.status, 'acknowledged');
  const resolved = await service.actOnEvent(owner, crypto.randomUUID(), { action: 'resolve' }) as { status: string };
  assert.equal(resolved.status, 'resolved');
});

const generatedReport = {
  template: 'daily_ops', title: '每日运营任务 · 2026-09-17', itemCount: 120, droppedCitations: 0,
  generatedAt: '2026-09-17T07:01:00.000Z',
  report: { summary: 'Fans want a poll', tasks: [{ title: 'Prepare poll', priority: 'high', suggestedAction: 'Post it' }] },
};

test('planForReport creates a dedup-keyed morning push and enqueues its send job', async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const service = new ScheduledNotificationService(mockDatabase((sql) => {
    if (sql.includes('FROM insight_report')) return { rows: [generatedReport], rowCount: 1 };
    if (sql.includes('FROM notification_rule')) return {
      rows: [{ id: 'rule-1', kind: 'morning_push', channel: 'email', email: 'ops@example.invalid', connected_account_id: null, weekly_template: null, weekly_delivery_mode: null, created_at: '', updated_at: '' }],
      rowCount: 1,
    };
    if (sql.includes('INSERT INTO notification_event')) return { rows: [{ id: 'event-1' }], rowCount: 1 };
    if (sql.includes('INSERT INTO job')) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql}`);
  }, statements));
  const result = await service.planForReport('workspace-1', crypto.randomUUID());
  assert.equal(result.created, 1);
  const insert = statements.find(entry => entry.sql.includes('INSERT INTO notification_event'))!;
  assert.equal(insert.values[2], 'morning_push:2026-09-17'); // dedup key = flow + UTC date
  assert.ok(statements.some(entry => entry.sql.includes("'notification.send'")));

  // 冲突（重复 plan）→ 不再创建事件、不再入队。
  const replay = new ScheduledNotificationService(mockDatabase((sql) => {
    if (sql.includes('FROM insight_report')) return { rows: [generatedReport], rowCount: 1 };
    if (sql.includes('FROM notification_rule')) return {
      rows: [{ id: 'rule-1', kind: 'morning_push', channel: 'email', email: 'ops@example.invalid', connected_account_id: null, weekly_template: null, weekly_delivery_mode: null, created_at: '', updated_at: '' }],
      rowCount: 1,
    };
    if (sql.includes('INSERT INTO notification_event')) return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO job')) throw new Error('must not enqueue on dedup conflict');
    throw new Error(`unexpected SQL: ${sql}`);
  }, statements));
  assert.equal((await replay.planForReport('workspace-1', crypto.randomUUID())).created, 0);
});

test('planForReport freezes weekly digest for approval and sends only the ready notice', async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const weeklyReport = { ...generatedReport, template: 'content_recap', title: '爆款内容复盘 · 周报 2026-09-15', report: { summary: 'Week findings', successFactors: [], nextTopics: [] } };
  const service = new ScheduledNotificationService(mockDatabase((sql) => {
    if (sql.includes('FROM insight_report')) return { rows: [weeklyReport], rowCount: 1 };
    if (sql.includes('FROM notification_rule')) return {
      rows: [{ id: 'rule-1', kind: 'weekly_report', channel: 'email', email: null, connected_account_id: null, weekly_template: 'content_recap', weekly_delivery_mode: 'approval', created_at: '', updated_at: '' }],
      rowCount: 1,
    };
    if (sql.includes('FROM workspace_membership')) return { rows: [{ email: 'owner@example.invalid' }], rowCount: 1 };
    if (sql.includes('INSERT INTO notification_event')) return { rows: [{ id: crypto.randomUUID() }], rowCount: 1 };
    if (sql.includes('INSERT INTO job')) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql}`);
  }, statements));
  const result = await service.planForReport('workspace-1', crypto.randomUUID());
  assert.equal(result.created, 2);
  const inserts = statements.filter(entry => entry.sql.includes('INSERT INTO notification_event'));
  const weekly = inserts.find(entry => entry.values[0] === 'weekly_report')!;
  assert.equal(weekly.values[1], 'pending_approval'); // frozen until a human approves
  assert.equal(weekly.values[2], 'weekly_report:2026-09-14'); // ISO week of 2026-09-17
  const ready = inserts.find(entry => entry.values[0] === 'weekly_ready')!;
  assert.equal(ready.values[1], 'queued');
  const sendJobs = statements.filter(entry => entry.sql.includes("'notification.send'"));
  assert.equal(sendJobs.length, 1); // only the ready notice goes out
});

test('planForReport raises an urgent alert only when high-severity risks exist', async () => {
  const risky = {
    ...generatedReport, template: 'community_digest', title: '社区周报',
    report: { summary: 's', conflictRisks: [{ risk: 'Raid threats', severity: 'high', citations: [{ ref: 'c1', snippet: 'verbatim' }] }] },
  };
  const calm = { ...generatedReport, template: 'community_digest', report: { summary: 's', conflictRisks: [] } };
  const make = (report: unknown) => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const service = new ScheduledNotificationService(mockDatabase((sql) => {
      if (sql.includes('FROM insight_report')) return { rows: [report], rowCount: 1 };
      if (sql.includes('FROM notification_rule')) return {
        rows: [{ id: 'rule-1', kind: 'urgent_risk', channel: 'email', email: 'ops@example.invalid', connected_account_id: null, weekly_template: null, weekly_delivery_mode: null, created_at: '', updated_at: '' }],
        rowCount: 1,
      };
      if (sql.includes('INSERT INTO notification_event')) return { rows: [{ id: 'event-1' }], rowCount: 1 };
      if (sql.includes('INSERT INTO job')) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    }, statements));
    return { service, statements };
  };
  const alerted = make(risky);
  assert.equal((await alerted.service.planForReport('workspace-1', crypto.randomUUID())).created, 1);
  const alertInsert = alerted.statements.find(entry => entry.sql.includes('INSERT INTO notification_event'))!;
  assert.equal(await (async () => alertInsert.values[0])(), 'urgent_risk');
  const quiet = make(calm);
  assert.equal((await quiet.service.planForReport('workspace-1', crypto.randomUUID())).created, 0);
});

test('enqueueEveningRecaps skips quiet workspaces and dedups by date', async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const service = new ScheduledNotificationService(mockDatabase((sql) => {
    if (sql.includes('scheduled_notification_workspaces')) return { rows: [{ workspace_id: 'workspace-1' }], rowCount: 1 };
    if (sql.includes('FROM notification_rule')) return {
      rows: [{ id: 'rule-1', kind: 'evening_recap', channel: 'email', email: 'ops@example.invalid', connected_account_id: null, weekly_template: null, weekly_delivery_mode: null, created_at: '', updated_at: '' }],
      rowCount: 1,
    };
    if (sql.includes("action_feedback <> '{}'")) return {
      rows: [{ template: 'daily_ops', report: { tasks: [{ title: 'Prepare poll' }] }, feedback: { 'tasks:0': { status: 'completed', effect: 'improved', updatedAt: '2026-09-17T09:00:00.000Z' } } }],
      rowCount: 1,
    };
    if (sql.includes("template = 'daily_ops' AND generated_at >=")) return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO notification_event')) return { rows: [{ id: 'event-1' }], rowCount: 1 };
    if (sql.includes('INSERT INTO job')) return { rows: [], rowCount: 1 };
    throw new Error(`unexpected SQL: ${sql}`);
  }, statements));
  const enqueued = await service.enqueueEveningRecaps(new Date('2026-09-17T20:00:00.000Z'));
  assert.equal(enqueued, 1);
  const insert = statements.find(entry => entry.sql.includes('INSERT INTO notification_event'))!;
  assert.equal(insert.values[2], 'evening_recap:2026-09-17');
});

test('enqueueWeeklyReports respects the 6-day dedup window', async () => {
  const make = (hasRecent: boolean) => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const service = new ScheduledNotificationService(mockDatabase((sql) => {
      if (sql.includes('scheduled_notification_workspaces')) return { rows: [{ workspace_id: 'workspace-1' }], rowCount: 1 };
      if (sql.includes('FROM notification_rule')) return {
        rows: [{ id: 'rule-1', kind: 'weekly_report', channel: 'email', email: null, connected_account_id: null, weekly_template: 'content_recap', weekly_delivery_mode: 'approval', created_at: '', updated_at: '' }],
        rowCount: 1,
      };
      if (sql.includes("interval '6 days'")) return { rows: hasRecent ? [{ '?column?': 1 }] : [], rowCount: hasRecent ? 1 : 0 };
      if (sql.includes('FROM workspace_membership')) return { rows: [{ user_id: 'user-1' }], rowCount: 1 };
      if (sql.includes('FROM import_batch')) return { rows: [{ id: 'batch-1' }], rowCount: 1 };
      if (sql.includes('COUNT(*)::text')) return { rows: [{ count: '42' }], rowCount: 1 };
      if (sql.includes('INSERT INTO insight_report')) return { rows: [{ id: 'report-1' }], rowCount: 1 };
      if (sql.includes('INSERT INTO job')) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    }, statements));
    return { service, statements };
  };
  assert.equal(await (await make(true)).service.enqueueWeeklyReports(), 0);
  const fresh = make(false);
  assert.equal(await fresh.service.enqueueWeeklyReports(), 1);
  assert.ok(fresh.statements.some(entry => entry.sql.includes("'insight.generate'")));
});
