import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { WeeklyHistoryService } from '../src/insight-service/weekly-history';
import type { Database } from '../src/foundation/database';

test('PostgreSQL weekly attribution survives cross-week notes, status edits and foreign audit rows', async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'disposable TEST_DATABASE_URL required');
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15s'");
    assert.equal((await client.query("SELECT to_regclass('public.app_user') AS users")).rows[0].users, null,
      'Refusing an existing platform database');
    await client.query(`CREATE TEMP TABLE insight_report (id uuid, workspace_id uuid, title text, template text,
      generated_at timestamptz, created_at timestamptz, status text, report jsonb);
      CREATE TEMP TABLE audit_event (id bigint GENERATED ALWAYS AS IDENTITY, workspace_id uuid, event_type text, created_at timestamptz, payload jsonb);
      CREATE TEMP TABLE weekly_review_snapshot (id uuid, workspace_id uuid, week_start date, week_end date, created_at timestamptz, payload jsonb)`);
    const workspace = '11111111-1111-4111-8111-111111111111';
    const foreign = '22222222-2222-4222-8222-222222222222';
    const reportId = '33333333-3333-4333-8333-333333333333';
    await client.query(`INSERT INTO insight_report VALUES ($1,$2,'Tasks','daily_ops','2026-09-01','2026-09-01','generated',$3)`,
      [reportId, workspace, { tasks: [{ title: 'Task' }] }]);
    const insert = (at: string, status: string, previous: string | null, owner = workspace) => client.query(
      `INSERT INTO audit_event (workspace_id,event_type,created_at,payload) VALUES ($1,'insight.action_feedback',$2,$3)`,
      [owner, at, { reportId, actionKey: 'tasks:0', previous: previous ? { status: previous } : null,
        feedback: { status, effect: status === 'completed' ? 'improved' : 'unknown', note: 'edited', updatedAt: at } }]);
    await insert('2026-09-18T12:00:00Z', 'completed', 'adopted');
    await insert('2026-09-24T12:00:00Z', 'completed', 'completed'); // note-only edit
    await insert('2026-09-24T13:00:00Z', 'completed', null, foreign);
    const database = { withWorkspace: async (id: string, fn: Function) => {
      await client.query("SELECT set_config('app.workspace_id',$1,true)", [id]);
      return fn({ query: (sql: string, values?: unknown[]) => client.query(sql, values) });
    } } as unknown as Database;
    const service = new WeeklyHistoryService(database);
    const actor = { workspaceId: workspace, actorId: workspace, role: 'owner' as const };
    assert.equal((await service.history(actor, new Date('2026-09-19'))).current.totals.completed, 1);
    assert.equal((await service.history(actor, new Date('2026-09-25'))).current.totals.completed, 0);
    await insert('2026-09-25T14:00:00Z', 'dismissed', 'completed');
    assert.equal((await service.history(actor, new Date('2026-09-19'))).current.totals.completed, 1);
    assert.equal((await service.history(actor, new Date('2026-09-25'))).current.totals.dismissed, 1);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
