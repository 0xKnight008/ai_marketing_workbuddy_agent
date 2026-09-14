import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, TenantTransaction } from '../foundation/database';
import { summarizeWeeklySources, WeeklyReviewService, type WeeklySource } from './weekly-review';

const source = (): WeeklySource => ({
  id: 'report-1', title: 'Tasks', template: 'daily_ops', generatedAt: '2026-09-14T00:00:00Z',
  report: { summary: 'Findings', tasks: Array.from({ length: 7 }, (_, i) => ({ title: `Task ${i}` })) },
  feedback: {
    'tasks:0': { status: 'planned' }, 'tasks:1': { status: 'adopted' }, 'tasks:2': { status: 'dismissed' },
    'tasks:3': { status: 'completed', effect: 'improved', note: 'Observed replies', actorId: 'u1' },
    'tasks:4': { status: 'completed', effect: 'worse' }, 'tasks:5': { status: 'completed', effect: 'unknown' },
    'tasks:999': { status: 'completed', effect: 'improved' },
  },
});

test('six-template review uses all suggestions and known completed effects as explicit denominators', () => {
  const groups = summarizeWeeklySources([source()]);
  assert.equal(groups.length, 6);
  const group = groups.find(g => g.template === 'daily_ops')!;
  assert.deepEqual(group.counts, { actions: 7, reviewed: 6, planned: 1, adopted: 4, completed: 3, dismissed: 1, unreviewed: 1 });
  assert.equal(group.adoptionRate, 4 / 7);
  assert.equal(group.completionRate, 3 / 7);
  assert.equal(group.improvementRate, 1 / 2);
  assert.deepEqual(group.effects, { improved: 1, unchanged: 0, worse: 1, unknown: 1 });
  assert.equal(group.reports[0]?.summary, 'Findings');
  assert.equal(group.reports[0]?.actions[3]?.note, 'Observed replies');
  const empty = groups.find(g => g.template === 'content_recap')!;
  assert.equal(empty.adoptionRate, null);
  assert.equal(empty.improvementRate, null);
});

test('invalid feedback remains unreviewed; reopening completion changes current-state rates', () => {
  const row = source();
  row.feedback['tasks:3'] = { status: 'planned', effect: 'improved' };
  row.feedback['tasks:4'] = { status: 'planned', effect: 'unknown' };
  const group = summarizeWeeklySources([row]).find(g => g.template === 'daily_ops')!;
  assert.equal(group.counts.completed, 1);
  assert.equal(group.counts.unreviewed, 2);
  assert.equal(group.improvementRate, null);
});

test('weekly service scopes tenant and UTC half-open window; refuses silently truncated results', async () => {
  let rows: WeeklySource[] = [];
  const statements: string[] = [];
  const database = { withWorkspace: async <T>(workspace: string, operation: (tx: TenantTransaction) => Promise<T>) => {
    assert.equal(workspace, 'workspace-1');
    return operation({ query: async (sql: string, values: unknown[]) => {
      statements.push(sql);
      assert.match(sql, /workspace_id = current_setting/);
      assert.match(sql, /generated_at >= \$1::timestamptz AND generated_at < \$2::timestamptz/);
      assert.deepEqual(values, ['2026-09-07T12:00:00.000Z', '2026-09-14T12:00:00.000Z']);
      return { rows, rowCount: rows.length };
    } } as unknown as TenantTransaction);
  } } as Database;
  const service = new WeeklyReviewService(database);
  const actor = { workspaceId: 'workspace-1', actorId: 'user-1', role: 'viewer' as const };
  assert.equal((await service.review(actor, new Date('2026-09-14T12:00:00Z'))).templates.length, 6);
  rows = Array.from({ length: 501 }, source);
  await assert.rejects(service.review(actor, new Date('2026-09-14T12:00:00Z')), { statusCode: 422 });
  assert.ok(statements.every(sql => sql.trim().startsWith('SELECT')));
});
