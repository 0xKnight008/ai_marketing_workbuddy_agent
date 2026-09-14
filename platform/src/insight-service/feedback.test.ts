import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database, TenantTransaction } from '../foundation/database';
import type { ActorContext } from '../contracts/domain';
import { InsightFeedbackService, feedbackSchema, reportActions } from './feedback';

const id = '11111111-1111-4111-8111-111111111111';
const actor: ActorContext = { workspaceId: 'workspace-1', actorId: 'user-1', role: 'owner' };
function fixture(found = true) {
  let feedback: Record<string, unknown> = {};
  const statements: string[] = [];
  const events: unknown[] = [];
  const tx = { query: async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (sql.includes('FROM insight_report')) {
      assert.ok(sql.includes("workspace_id = current_setting('app.workspace_id')::uuid"));
      assert.ok(sql.includes("status = 'generated'"));
      return { rows: found ? [{ template: 'daily_ops', report: { tasks: [{ title: 'Reply to fans' }, { title: 'Prepare poll' }] }, feedback }] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE insight_report')) feedback = { ...feedback, ...JSON.parse(String(values[1])) };
    if (sql.startsWith('INSERT INTO audit_event')) events.push(values);
    return { rows: [], rowCount: 1 };
  } } as unknown as TenantTransaction;
  const database = { withWorkspace: async <T>(workspace: string, operation: (tx: TenantTransaction) => Promise<T>) => { assert.equal(workspace, actor.workspaceId); return operation(tx); } } as Database;
  return { service: new InsightFeedbackService(database), statements, events };
}

test('all six templates expose only server-defined action keys', () => {
  const examples = [
    ['content_recap', { nextTopics: ['Topic'] }, 'nextTopics:0'],
    ['comment_insights', { highValueComments: [{ replyDraft: 'Thanks' }] }, 'highValueComments:0'],
    ['product_opportunities', { opportunities: [{ validationAction: 'Poll' }] }, 'opportunities:0'],
    ['review_attribution', { priorityFixes: [{ fix: 'Packaging' }] }, 'priorityFixes:0'],
    ['community_digest', { activityIdeas: ['Q&A'] }, 'activityIdeas:0'],
    ['daily_ops', { tasks: [{ title: 'Reply' }] }, 'tasks:0'],
  ] as const;
  for (const [template, body, key] of examples) assert.equal(reportActions(template, body)[0]?.key, key);
});

test('feedback is persisted with actor attribution; retries are no-ops and other action feedback survives', async () => {
  const { service, events, statements } = fixture();
  const saved = await service.save(actor, id, 'tasks:0', { status: 'completed', effect: 'improved', note: 'More replies' });
  assert.equal(saved.actorId, actor.actorId);
  assert.equal(events.length, 1);
  assert.deepEqual(await service.save(actor, id, 'tasks:0', { status: 'completed', effect: 'improved', note: 'More replies' }), saved);
  assert.equal(events.length, 1);
  await service.save(actor, id, 'tasks:1', { status: 'adopted' });
  const list = await service.list(actor, id);
  assert.equal(list.canEdit, true);
  assert.equal((list.actions[0]!.feedback as { status: string }).status, 'completed');
  assert.equal((list.actions[1]!.feedback as { status: string }).status, 'adopted');
  assert.ok(statements.some(sql => sql.endsWith('FOR UPDATE')));
  assert.ok(statements.every(sql => !/INSERT INTO (job|approval_request|task_event)/.test(sql)));
});

test('viewer reads but cannot write; unknown action/report never writes', async () => {
  const { service, events } = fixture();
  assert.equal((await service.list({ ...actor, role: 'viewer' }, id)).canEdit, false);
  await assert.rejects(service.save({ ...actor, role: 'viewer' }, id, 'tasks:0', { status: 'planned' }), { statusCode: 403 });
  await assert.rejects(service.save(actor, id, 'tasks:999', { status: 'planned' }), { statusCode: 422 });
  assert.equal(events.length, 0);
  await assert.rejects(fixture(false).service.list(actor, id), { statusCode: 404 });
});

test('effect requires completion, length and unknown fields are rejected', () => {
  assert.equal(feedbackSchema.safeParse({ status: 'adopted', effect: 'improved' }).success, false);
  assert.equal(feedbackSchema.safeParse({ status: 'completed', note: 'x'.repeat(2001) }).success, false);
  assert.equal(feedbackSchema.safeParse({ status: 'completed', actorId: 'spoof' }).success, false);
  assert.equal(feedbackSchema.safeParse({ status: 'published' }).success, false);
});
