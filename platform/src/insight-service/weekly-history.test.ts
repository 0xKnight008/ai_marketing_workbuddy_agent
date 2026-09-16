import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, TenantTransaction } from '../foundation/database';
import { computeWeekExecution, isoWeekStart, WeeklyHistoryService, type HistorySource } from './weekly-history';

const MONDAY = new Date('2026-09-07T00:00:00.000Z'); // ISO week Monday (UTC)

test('isoWeekStart returns the UTC Monday of the containing ISO week', () => {
  assert.equal(isoWeekStart(new Date('2026-09-07T00:00:00Z')).toISOString(), '2026-09-07T00:00:00.000Z'); // Monday
  assert.equal(isoWeekStart(new Date('2026-09-11T23:59:59Z')).toISOString(), '2026-09-07T00:00:00.000Z'); // Friday
  assert.equal(isoWeekStart(new Date('2026-09-13T12:00:00Z')).toISOString(), '2026-09-07T00:00:00.000Z'); // Sunday
  assert.equal(isoWeekStart(new Date('2026-09-14T00:00:01Z')).toISOString(), '2026-09-14T00:00:00.000Z'); // next Monday
  assert.equal(isoWeekStart(new Date('2026-01-01T10:00:00Z')).toISOString(), '2025-12-29T00:00:00.000Z'); // year boundary
});

const source = (generatedAt: string): HistorySource => ({
  id: `report-${generatedAt}`, title: 'Tasks', template: 'daily_ops', generatedAt,
  report: { summary: 'Findings', tasks: [{ title: 'Task 0' }, { title: 'Task 1' }, { title: 'Task 2' }] },
  feedback: {
    // Completed inside the window although the report may be weeks old.
    'tasks:0': { status: 'completed', effect: 'improved', note: 'Replies up', actorId: 'u1', updatedAt: '2026-09-09T10:00:00.000Z' },
    // Decided before the window: not this week's execution.
    'tasks:1': { status: 'dismissed', effect: 'unknown', note: '', actorId: 'u1', updatedAt: '2026-08-30T10:00:00.000Z' },
    // No usable timestamp: cannot be attributed honestly.
    'tasks:2': { status: 'completed', effect: 'worse' },
    // Key not present in the immutable report body: ignored.
    'tasks:999': { status: 'completed', effect: 'improved', updatedAt: '2026-09-09T11:00:00.000Z' },
  },
});

test('execution-time attribution includes old reports completed this week and skips unattributable entries', () => {
  const old = source('2026-08-10T00:00:00.000Z');
  const recent = source('2026-09-08T00:00:00.000Z');
  const execution = computeWeekExecution([old, recent], MONDAY);
  assert.equal(execution.weekStart, '2026-09-07T00:00:00.000Z');
  assert.equal(execution.weekEnd, '2026-09-14T00:00:00.000Z');
  const group = execution.templates.find(entry => entry.template === 'daily_ops')!;
  assert.deepEqual(group.counts, { events: 2, planned: 0, adopted: 2, completed: 2, dismissed: 0 });
  assert.equal(group.adoptionRate, 1);
  assert.equal(group.completionRate, 1);
  assert.equal(group.improvementRate, 1);
  assert.equal(group.reports.length, 2); // both the old and the recent report contributed
  assert.equal(execution.totals.events, 2);
  assert.equal(execution.totals.completed, 2);
  assert.equal(execution.completedActions.length, 2);
  assert.ok(execution.completedActions.every(action => action.status === 'completed'));
  const empty = execution.templates.find(entry => entry.template === 'content_recap')!;
  assert.equal(empty.counts.events, 0);
  assert.equal(empty.adoptionRate, null);
});

test('half-open window: Sunday night included, next Monday excluded', () => {
  const row = source('2026-09-01T00:00:00.000Z');
  row.feedback['tasks:0'] = { status: 'completed', effect: 'unchanged', note: '', updatedAt: '2026-09-13T23:59:59.000Z' };
  row.feedback['tasks:1'] = { status: 'planned', effect: 'unknown', note: '', updatedAt: '2026-09-14T00:00:00.000Z' };
  const execution = computeWeekExecution([row], MONDAY);
  const group = execution.templates.find(entry => entry.template === 'daily_ops')!;
  assert.equal(group.counts.events, 1);
  assert.equal(group.counts.completed, 1);
  assert.equal(group.effects.unchanged, 1);
});

type QueryHandler = (sql: string, values: unknown[]) => { rows: unknown[]; rowCount: number };
function mockDatabase(handler: QueryHandler, statements: string[] = []): Database {
  return {
    withWorkspace: async <T>(workspace: string, operation: (tx: TenantTransaction) => Promise<T>) => {
      assert.equal(workspace, 'workspace-1');
      return operation({ query: async (sql: string, values: unknown[]) => { statements.push(sql); return handler(sql, values); } } as unknown as TenantTransaction);
    },
  } as Database;
}

const owner = { workspaceId: 'workspace-1', actorId: '11111111-1111-4111-8111-111111111111', role: 'owner' as const };
const viewer = { ...owner, role: 'viewer' as const };

test('seal freezes the week, writes an audit event, and rejects re-sealing with 409', async () => {
  let conflict = false;
  let auditPayload: unknown = null;
  const database = mockDatabase((sql, values) => {
    if (sql.includes('FROM insight_report')) return { rows: [source('2026-08-10T00:00:00.000Z')], rowCount: 1 };
    if (sql.includes('INSERT INTO weekly_review_snapshot')) return conflict ? { rows: [], rowCount: 0 } : { rows: [{ id: 'snap-1', created_at: '2026-09-10T08:00:00.000Z' }], rowCount: 1 };
    if (sql.includes('INSERT INTO audit_event')) { auditPayload = values; return { rows: [], rowCount: 1 }; }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const service = new WeeklyHistoryService(database);
  const sealed = await service.seal(owner, {}, new Date('2026-09-10T08:00:00Z')) as { weekStart: string; totals: { completed: number } };
  assert.equal(sealed.weekStart, '2026-09-07T00:00:00.000Z');
  assert.equal(sealed.totals.completed, 1);
  assert.ok(Array.isArray(auditPayload));
  assert.equal((auditPayload as unknown[])[2], 'weekly_review.snapshot_created');
  conflict = true;
  await assert.rejects(service.seal(owner, {}, new Date('2026-09-10T08:00:00Z')), { statusCode: 409, code: 'weekly_review_snapshot_exists' });
});

test('seal validates role, Monday alignment, and future weeks', async () => {
  const service = new WeeklyHistoryService(mockDatabase(() => ({ rows: [], rowCount: 0 })));
  await assert.rejects(service.seal(viewer, {}, new Date('2026-09-10T08:00:00Z')), { statusCode: 403 });
  await assert.rejects(service.seal(owner, { weekStart: '2026-09-08' }, new Date('2026-09-10T08:00:00Z')), { statusCode: 422, code: 'weekly_review_week_start_must_be_monday' });
  await assert.rejects(service.seal(owner, { weekStart: '2026-09-14' }, new Date('2026-09-10T08:00:00Z')), { statusCode: 422, code: 'weekly_review_future_week' });
  await assert.rejects(service.seal(owner, { weekStart: 'not-a-date' }, new Date('2026-09-10T08:00:00Z')));
});

test('history marks a sealed current week and compares only consecutive snapshots', async () => {
  const snapshot = (weekStart: string, weekEnd: string, completed: number) => ({
    id: `snap-${weekStart}`, week_start: weekStart, week_end: weekEnd, created_at: `${weekEnd}T00:00:00.000Z`,
    payload: { totals: { events: completed + 1, planned: 0, adopted: completed, completed, dismissed: 1, effects: { improved: completed, unchanged: 0, worse: 0, unknown: 0 }, knownEffects: completed, adoptionRate: 0.5, completionRate: 0.5, improvementRate: 1 } },
  });
  const database = mockDatabase((sql) => {
    if (sql.includes('FROM insight_report')) return { rows: [source('2026-09-01T00:00:00.000Z')], rowCount: 1 };
    if (sql.includes('FROM weekly_review_snapshot')) return {
      rows: [snapshot('2026-08-31', '2026-09-07', 2), snapshot('2026-08-17', '2026-08-24', 1)], // gap: not consecutive
      rowCount: 2,
    };
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const service = new WeeklyHistoryService(database);
  const result = await service.history(owner, new Date('2026-09-10T08:00:00Z')) as {
    current: { sealed: boolean; comparison: { completed: number } | null; totals: { completed: number } };
    weeks: Array<{ weekStart: string; comparison: unknown }>;
  };
  assert.equal(result.current.sealed, false);
  assert.equal(result.current.totals.completed, 1);
  assert.equal(result.current.comparison?.completed, -1); // 1 this week vs 2 sealed last week
  assert.equal(result.weeks.length, 2);
  assert.equal(result.weeks[0]?.comparison, null); // previous sealed week is not consecutive
  assert.equal(result.weeks[1]?.comparison, null);
});

test('snapshotDetail returns the frozen payload and 404s when the week was never sealed', async () => {
  const payload = { weekStart: '2026-08-31T00:00:00.000Z', totals: { events: 3 }, templates: [], completedActions: [] };
  let rows: unknown[] = [{ id: 'snap-1', week_start: '2026-08-31', week_end: '2026-09-07', created_at: '2026-09-07T01:00:00.000Z', payload }];
  const service = new WeeklyHistoryService(mockDatabase(() => ({ rows, rowCount: rows.length })));
  const detail = await service.snapshotDetail(owner, '2026-08-31') as { totals: { events: number }; sealedAt: string };
  assert.equal(detail.totals.events, 3);
  assert.equal(detail.sealedAt, '2026-09-07T01:00:00.000Z');
  rows = [];
  await assert.rejects(service.snapshotDetail(owner, '2026-08-31'), { statusCode: 404, code: 'weekly_review_snapshot_not_found' });
});
