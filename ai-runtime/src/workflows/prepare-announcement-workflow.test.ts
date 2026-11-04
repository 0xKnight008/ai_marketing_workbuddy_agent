import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
process.env.AI_MODEL_ROUTING_MODE = 'litellm';
process.env.AI_PROXY_MODEL_PROFILE = 'onetoken';
process.env.OPENAI_BASE_URL = 'https://proxy.invalid/v1';
process.env.OPENAI_API_KEY = 'synthetic-test-key';
const storage = mkdtempSync(join(tmpdir(), 'pipeline-reasoning-'));
process.env.MASTRA_STORAGE_URL = 'file:' + join(storage, 'runtime.db');
after(() => rmSync(storage, { recursive: true, force: true }));
const { prepareAnnouncementWorkflow } = await import('./prepare-announcement-workflow');
const { RunServiceEventEmitter, registerEmitter, removeEmitter } = await import('../events/emitter');
const { runtimeCostContext, boundedModelFetch } = await import('../lib/cost-metering');
const { requestTraceContext, requestTraceMiddleware } = await import('../lib/request-trace');
const { prepareAnnouncementRequestSchema } = await import('../schemas/announcement');
const input = prepareAnnouncementRequestSchema.parse({
  platformRunId: randomUUID(), workspaceId: randomUUID(), actorId: randomUUID(),
  input: { brief: 'Announce our new evidence links on X.', targets: [{ platform: 'x', accountId: 'synthetic-x' }] },
  executionContext: { brandProfile: { language: 'en' }, runPolicy: { modelBand: 'eco', maxOutputTokens: 1500 } },
});
const draft = { platform: 'x', accountId: 'synthetic-x', content: 'New evidence links are here.', hashtags: [], characterCount: 27 };
const outputs = [
  { summary: 'New evidence links', perTarget: [{ platform: 'x', accountId: 'synthetic-x', angle: 'Launch', keyPoints: ['Evidence links'] }] },
  { drafts: [draft] }, { passed: true, issues: [] },
];
test('real announcement workflow respects the reasoning budget and keeps approval closed on truncation', async t => {
  for (const truncated of [false, true]) await t.test(truncated ? 'reasoning-only length failure' : 'three model steps reach approval-ready plan', async t => {
    const run = await prepareAnnouncementWorkflow.createRun();
    const emitter = new RunServiceEventEmitter(input.platformRunId, input.workspaceId, run.runId);
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    t.mock.method(emitter, 'emit', async (type: string, payload?: Record<string, unknown>) => { events.push({ type, payload }); });
    registerEmitter(run.runId, emitter);
    let calls = 0, persisted = 0;
    const trace = { requestId: randomUUID(), taskId: input.platformRunId, workspaceId: input.workspaceId, operationId: randomUUID(), band: 'eco', attempts: [], failureCode: undefined as string | undefined, persist: async () => { persisted++; } };
    const upstream = async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), 'https://proxy.invalid/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'primary-eco');
      assert.ok(body.max_tokens > 1500, "credit-derived budget must override the former tier cap");
      const stopped = truncated && calls === 1;
      const content = stopped ? '' : JSON.stringify(outputs[calls]);
      calls++;
      assert.ok(calls <= 3, 'no hidden paid repair retries');
      return Response.json({ id: 'synthetic-' + calls, object: 'chat.completion', created: 1, model: 'primary-eco',
        choices: [{ index: 0, message: { role: 'assistant', content, reasoning_content: 'synthetic reasoning' }, finish_reason: stopped ? 'length' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: stopped ? body.max_tokens : 200, total_tokens: stopped ? body.max_tokens + 100 : 300 },
      });
    };
    t.mock.method(globalThis, 'fetch', (url: string | URL | Request, init?: RequestInit) => boundedModelFetch(upstream, url, init));
    try {
      const outcome = await requestTraceContext.run(trace, () => runtimeCostContext.run({ workspaceId: input.workspaceId, operationId: trace.operationId, requestId: trace.requestId, maxCostNanos: '100000000', maxInputTokens: 8000, maxOutputTokens: 1500, creditBoundOutput: true, rate: { version: 'test', model: 'primary-eco', responseModels: ['primary-eco'], inputUsdPerMillion: '1', outputUsdPerMillion: '1', cacheUsdPerMillion: '0.1', source: 'synthetic', verifiedAt: '2026-11-04T00:00:00Z' } }, () => run.start({ inputData: input })));
      assert.equal(outcome.status, truncated ? 'failed' : 'success');
      assert.equal(calls, truncated ? 2 : 3);
      const plan = events.find(e => e.type === 'action_plan.created');
      if (truncated) {
        assert.equal(plan, undefined);
        assert.equal(trace.failureCode, 'ai_confirmed_budget_exhausted');
        assert.ok(persisted > 0);
        assert.equal(events.find(e => e.type === 'ai_step.failed')?.payload?.error, 'ai_confirmed_budget_exhausted');
      } else {
        assert.equal(plan?.payload?.requiresApproval, true);
        assert.equal(plan?.payload?.blockedByCompliance, false);
      }
    } finally { removeEmitter(run.runId); }
  });
});

test('announcement request traces retain platform run and tier correlation', async () => {
  const c = { req: { method: 'POST', json: async () => input }, res: new Response(null, {status:202}), header: () => {} };
  await requestTraceMiddleware(c, async () => {
    assert.equal(requestTraceContext.getStore()?.taskId, input.platformRunId);
    assert.equal(requestTraceContext.getStore()?.workspaceId, input.workspaceId);
    assert.equal(requestTraceContext.getStore()?.band, 'eco');
  });
});
