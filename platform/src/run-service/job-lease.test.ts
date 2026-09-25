import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { JobLeaseLost, withJobLease } from './job-lease';
import type { RunWorkerDatabase, ClaimedJob } from './worker-runner';

const job: ClaimedJob = { id: 'job', workspaceId: 'workspace', runId: null, kind: 'insight.generate', payload: {}, attempt: 2 };
function fixture() {
  const state = { valid: true, renewals: 0, fail: false };
  const database = { claimNextJob: async () => job, withWorkspace: async (_workspace: string, operation: Function) => operation({
    query: async (sql: string, values: unknown[]) => {
      assert.match(sql, /locked_by = \$3 AND attempt = \$4/);
      assert.match(sql, /locked_at > now\(\) - interval '5 minutes'/);
      assert.deepEqual(values, ['job', 'workspace', 'worker', 2]);
      state.renewals++;
      if (state.fail) throw new Error('database unavailable');
      return { rows: [], rowCount: state.valid ? 1 : 0 };
    },
  }) } as unknown as RunWorkerDatabase;
  return { state, database };
}

test('renews throughout a 20-minute remote wait and stops after completion', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { state, database } = fixture();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let committed = false;
  const running = withJobLease(database, job, 'worker', async scoped => {
    await waiting;
    await scoped.withWorkspace('workspace', async () => { committed = true; });
  });
  await setImmediate();
  for (let minute = 0; minute < 40; minute++) { t.mock.timers.tick(30_000); await setImmediate(); }
  assert.ok(state.renewals >= 41);
  release(); await running;
  assert.equal(committed, true);
  const count = state.renewals;
  t.mock.timers.tick(300_000); await setImmediate();
  assert.equal(state.renewals, count);
});

for (const reason of ['reclaimed', 'database-error'] as const) test(`lost lease fences old result and failure writes (${reason})`, async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { state, database } = fixture();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let wrote = false;
  const running = withJobLease(database, job, 'worker', async scoped => {
    await waiting;
    for (const phase of ['result', 'failure']) {
      await assert.rejects(scoped.withWorkspace('workspace', async () => { wrote = true; return phase; }), JobLeaseLost);
    }
  });
  await setImmediate();
  if (reason === 'reclaimed') state.valid = false; else state.fail = true;
  t.mock.timers.tick(30_000); await setImmediate();
  release(); await running;
  assert.equal(wrote, false);
});

test('an already expired/reclaimed job never starts work', async () => {
  const { state, database } = fixture(); state.valid = false;
  await assert.rejects(withJobLease(database, job, 'worker', async () => assert.fail('must not run')), JobLeaseLost);
});
