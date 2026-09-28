import assert from 'node:assert/strict';
import test from 'node:test';
import { publishConfirmed, ZernioPostPending } from './zernio-publication';
import type { ClaimedJob, RunWorkerDatabase, RunWorkerZernio } from './worker-runner';
import type { ActionPlan } from '../contracts/ai-runtime-event';

const action: ActionPlan['actions'][number] = { stepOrder: 1, type: 'social.create_post', platform: 'linkedin', accountId: 'account', content: 'Approved', hashtags: [], mode: 'publish_now', idempotencyKey: 'stable', requiresApproval: true };
const result = { postId: 'post', status: 'published', accountId: 'account', platform: 'linkedin' };
function fixture() {
  const job: ClaimedJob = { id: 'job', workspaceId: 'workspace', runId: 'run', kind: 'execute_approved_actions', payload: {}, attempt: 1 };
  const saved: Record<string, unknown> = {};
  const database: RunWorkerDatabase = {
    claimNextJob: async () => job,
    withWorkspace: async (workspace, operation) => {
      assert.equal(workspace, 'workspace');
      return operation({ query: async (_sql, values) => {
        assert.equal(values?.[0], 'job'); assert.equal(values?.[1], 'workspace');
        saved[String(values?.[2])] = JSON.parse(String(values?.[3]));
        return { rows: [], rowCount: 1 };
      } });
    },
  };
  return { job, database, saved };
}

test('accepted post survives restart; only GET is used until confirmed', async () => {
  const { job, database, saved } = fixture();
  let posts = 0; let reads = 0;
  const provider: RunWorkerZernio = {
    executeAction: async () => { posts++; return { ...result, status: 'pending' }; },
    getActionResult: async id => { assert.equal(id, 'post'); reads++; return result; },
  };
  await assert.rejects(publishConfirmed(database, provider, job, action, 1_000), ZernioPostPending);
  const resumed = { ...job, payload: { zernioReceipts: JSON.parse(JSON.stringify(saved)) }, attempt: 2 };
  assert.equal((await publishConfirmed(database, provider, resumed, action, 2_000)).status, 'published');
  await publishConfirmed(database, provider, resumed, action, 3_000);
  assert.equal(posts, 1); assert.equal(reads, 1);
});

test('failed/partial receipts cannot be retried as new posts or accepted as success', async () => {
  const { job, database } = fixture(); let posts = 0;
  const provider = { executeAction: async () => { posts++; return { ...result, status: 'failed' }; } };
  await assert.rejects(publishConfirmed(database, provider, job, action), /not published/);
  await assert.rejects(publishConfirmed(database, provider, job, action), /not published/);
  assert.equal(posts, 1);
});

test('unknown submission cannot be re-POSTed beyond supplier idempotency window', async () => {
  const { job, database } = fixture(); let posts = 0;
  const provider = { executeAction: async () => { posts++; throw new Error('ambiguous timeout'); } };
  await assert.rejects(publishConfirmed(database, provider, job, action, 1_000), /timeout/);
  await assert.rejects(publishConfirmed(database, provider, job, action, 1_000 + 23 * 3600_000), /manual reconciliation/);
  assert.equal(posts, 1);
});

test('changed actions, unverified responses and wrong accounts fail closed', async () => {
  const { job, database } = fixture();
  await publishConfirmed(database, { executeAction: async () => result }, job, action);
  await assert.rejects(publishConfirmed(database, { executeAction: async () => result }, job, { ...action, content: 'Changed' }), /changed/);
  for (const value of [undefined, { posted: true }, { ...result, accountId: 'foreign' }]) {
    const current = fixture();
    await assert.rejects(publishConfirmed(current.database, { executeAction: async () => value }, current.job, action));
  }
});

test('long schedules use the saved post ID, never the expired POST replay window', async () => {
  const { job, database } = fixture();
  const scheduled = { ...action, mode: 'schedule' as const, scheduledAt: '2026-12-01T00:00:00Z' };
  const start = Date.parse('2026-11-01T00:00:00Z'); let posts = 0;
  const provider = { executeAction: async () => { posts++; return { ...result, status: 'pending' }; }, getActionResult: async () => result };
  await assert.rejects(publishConfirmed(database, provider, job, scheduled, start), ZernioPostPending);
  await publishConfirmed(database, provider, job, scheduled, Date.parse(scheduled.scheduledAt));
  assert.equal(posts, 1);
});
