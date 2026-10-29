import { Hono } from 'hono';
import { timeout } from 'hono/timeout';

import { classifyRequestSchema } from '../schemas/classify';
import { insightReportRequestSchema } from '../schemas/insights';
import { topicProposeRequestSchema, topicAssignRequestSchema } from '../schemas/topics';
import { prepareAnnouncementRequestSchema } from '../schemas/announcement';
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const directory = mkdtempSync(join(tmpdir(), "piggy-metering-runtime-"));
process.env.MASTRA_STORAGE_URL = "file:" + join(directory, "metering.db");
after(() => rmSync(directory, { recursive: true, force: true }));
const httpToken = "runtime-http-fixture-token";
process.env.INTERNAL_API_TOKEN = httpToken;
const { internalAuth } = await import("../internal-api/auth");
const { loadConfig } = await import("../config");
const {
  runtimeCostContext,
  readRuntimeRequestBody,
  boundedModelFetch,
  requestReceipts,
  meteredRequestMiddleware,
} = await import("./cost-metering");
const rate = {
  version: "fixture-v1",
  model: "primary-flagship",
  responseModels: ["actual-fixture"],
  inputUsdPerMillion: "2",
  outputUsdPerMillion: "10",
  cacheUsdPerMillion: "0.2",
  source: "test fixture only",
  verifiedAt: "2026-10-24T00:00:00Z",
};
const envelope = () => ({
  workspaceId: randomUUID(),
  operationId: randomUUID(),
  requestId: randomUUID(),
  rate,
  maxCostNanos: "5000000",
  maxInputTokens: 512,
  maxOutputTokens: 100,
});
test("bounds provider output before sending, removes leaked SDK params and preserves native JSON schema", async () => {
  const meta = envelope();
  let calls = 0;
  await runtimeCostContext.run(meta, () =>
    boundedModelFetch(
      async (_input, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.max_tokens, 100);
        assert.equal(body.strictJsonSchema, undefined);
        assert.equal(body.temperature, undefined);
        assert.equal(body.response_format.type, "json_schema");
        return Response.json({
          model: "actual-fixture",
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        });
      },
      "https://proxy.test/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: "primary-flagship",
          temperature: 0,
          strictJsonSchema: true,
          messages: [{ role: "user", content: "Return JSON." }],
          max_tokens: 10000,
          response_format: {
            type: "json_schema",
            json_schema: { name: "test", schema: { type: "object" } },
          },
        }),
      },
    ),
  );
  assert.equal(calls, 1);
  const [receipt] = await requestReceipts(meta.requestId);
  assert.ok(receipt);
  assert.equal(receipt.costNanos, "700000");
  assert.equal(receipt.model, "actual-fixture");
});
test("rejects an unaffordable request or oversized context before any provider call", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({});
  };
  await assert.rejects(
    runtimeCostContext.run({ ...envelope(), maxCostNanos: "1" }, () =>
      boundedModelFetch(fetcher, "https://proxy.test/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "primary-flagship",
          messages: [{ role: "user", content: "Hi" }],
        }),
      }),
    ),
    /confirmed_budget/,
  );
  await assert.rejects(
    runtimeCostContext.run(envelope(), () =>
      boundedModelFetch(fetcher, "https://proxy.test/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "primary-flagship",
          messages: [{ role: "user", content: "x".repeat(1000) }],
        }),
      }),
    ),
    /input_exceeds/,
  );
  assert.equal(calls, 0);
});
test("missing usage stays unknown and cannot be mistaken for a free model call", async () => {
  const meta = envelope();
  await runtimeCostContext.run(meta, () =>
    boundedModelFetch(
      async () => Response.json({ model: "actual-fixture" }),
      "https://proxy.test/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: "primary-flagship",
          messages: [{ role: "user", content: "Hi" }],
        }),
      },
    ),
  );
  const [receipt] = await requestReceipts(meta.requestId);
  assert.equal(receipt?.status, "unknown");
  assert.equal(receipt?.costNanos, null);
});
test("durable request replay returns the stored result rather than repeating a paid call", async () => {
  const meta = envelope(),
    payload = { goal: "test", _metering: meta };
  let generations = 0;
  const make = () => ({
    req: {
      method: "POST",
      path: "/internal/task-step",
      json: async () => structuredClone(payload),
    },
    res: Response.json({}),
    json: (body: unknown, status: number) => Response.json(body, { status }),
  });
  const first = make();
  await meteredRequestMiddleware(first, async () => {
    generations++;
    await runtimeCostContext.run(meta, () =>
      boundedModelFetch(
        async () =>
          Response.json({
            model: "actual-fixture",
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
        "https://proxy.test/v1/chat/completions",
        {
          method: "POST",
          body: JSON.stringify({
            model: "primary-flagship",
            messages: [{ role: "user", content: "Hi" }],
          }),
        },
      ),
    );
    first.res = Response.json({ ok: true });
  });
  assert.equal(((await first.res.json()) as { ok: boolean }).ok, true);
  const replay = make();
  const cached = await meteredRequestMiddleware(replay, async () => {
    throw new Error("must not call a model again");
  });
  assert.ok(cached);
  assert.equal(((await cached.json()) as { ok: boolean }).ok, true);
  assert.equal(generations, 1);
});

const httpCases = [
  { path: '/internal/classify', schema: classifyRequestSchema, body: { items: [{ index: 0, text: 'Where is the guide?' }] } },
  { path: '/internal/insight-report', schema: insightReportRequestSchema, body: { template: 'comment_insights', totals: { items: 1, taggedItems: 0, tagDistribution: {} }, topItems: [], tagSamples: [] } },
  { path: '/internal/topics/propose', schema: topicProposeRequestSchema, body: { items: [{ index: 0, text: 'Where is the guide?' }] } },
  { path: '/internal/topics/assign', schema: topicAssignRequestSchema, body: { items: [{ index: 0, text: 'Where is the guide?' }], taxonomy: [{ key: 'guide', label: 'Guide', description: 'Finding the guide' }] } },
  { path: '/internal/ai-runs/prepare-announcement', schema: prepareAnnouncementRequestSchema, body: { platformRunId: 'run-fixture', workspaceId: 'workspace-fixture', actorId: 'actor-fixture', input: { brief: 'Write a welcome draft', targets: [{ platform: 'linkedin', accountId: 'fixture' }] } } },
];

function httpApp(entry: typeof httpCases[number]) {
  const app = new Hono();
  let calls = 0;
  app.post(entry.path, internalAuth, meteredRequestMiddleware, async c => {
    const body = await readRuntimeRequestBody(c);
    const parsed = entry.schema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    assert.ok(body && typeof body === 'object');
    assert.equal(Object.hasOwn(body, '_metering'), false);
    await boundedModelFetch(async () => {
      calls++;
      return Response.json({ model: 'actual-fixture', usage: { prompt_tokens: 100, completion_tokens: 50 } });
    }, 'https://fixture.invalid/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'primary-flagship', messages: [{ role: 'user', content: 'fixture' }] }) });
    return c.json({ ok: true });
  });
  const send = (body: unknown, token = httpToken) => app.request(entry.path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': token }, body: JSON.stringify(body) });
  return { send, calls: () => calls };
}

for (const entry of httpCases) {
  for (const band of ['eco', 'standard', 'flagship']) {
    for (const shadow of [true, false]) {
      test(`HTTP ${entry.path}/${band}/${shadow ? 'shadow' : 'cost-v1'} separates authenticated metering from strict business fields and replays once`, async () => {
        const { send, calls } = httpApp(entry);
        const payload = { ...entry.body, ...(entry.path.includes('prepare-announcement') ? {} : { modelBand: band }), _metering: { ...envelope(), band, shadow } };
        const first = await send(payload);
        const result = await first.json() as { ok: boolean; _metering: Array<{ status: string; costNanos: string }> };
        assert.equal(first.status, 200, JSON.stringify(result));
        assert.equal(result.ok, true);
        assert.equal(result._metering.length, 1);
        const receipt = result._metering[0];
        assert.ok(receipt);
        assert.equal(receipt.status, 'known');
        assert.equal(receipt.costNanos, '700000');
        assert.equal(calls(), 1);
        const replay = await send(payload);
        assert.equal(replay.status, 200);
        assert.deepEqual(await replay.json(), result);
        const conflict = await send({ ...payload, changedBusinessField: true });
        assert.equal(conflict.status, 409);
        assert.equal(calls(), 1);
        assert.ok(Object.hasOwn(payload, '_metering'), 'separate HTTP requests retain their own original transport envelope');
      });
    }
  }
}

test('HTTP rejects unauthorized or malformed envelopes and still rejects unknown business fields before any model call', async () => {
  const { send, calls } = httpApp(httpCases[0]!);
  const payload = { ...httpCases[0]!.body, _metering: envelope() };
  assert.equal((await send(payload, 'wrong-token')).status, 401);
  assert.equal((await send({ ...payload, _metering: { ...envelope(), maxCostNanos: '0' } })).status, 400);
  const unknown = await send({ ...payload, _metering: envelope(), unrelatedField: true });
  assert.equal(unknown.status, 400);
  assert.equal(((await unknown.json()) as { error: string }).error, 'invalid_request');
  assert.equal(calls(), 0);
});

test('HTTP legacy requests retain strict business validation without creating metered receipts', async () => {
  const { send, calls } = httpApp(httpCases[0]!);
  const response = await send(httpCases[0]!.body);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls(), 1);
});


test('parallel HTTP requests keep business bodies scoped to their own metering context', async () => {
  const app = new Hono();
  app.post('/parallel', internalAuth, meteredRequestMiddleware, async c => {
    const first = await readRuntimeRequestBody(c);
    await new Promise<void>(resolve => setImmediate(resolve));
    const second = await readRuntimeRequestBody(c);
    assert.deepEqual(second, first);
    return c.json({ body: second });
  });
  const payloads = [
    { text: 'workspace A', _metering: envelope() },
    { text: 'workspace B', _metering: envelope() },
    { text: 'legacy request' },
  ];
  const responses = await Promise.all(payloads.map(body => app.request('/parallel', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': httpToken }, body: JSON.stringify(body),
  })));
  for (let i = 0; i < responses.length; i++) {
    const response = responses[i]!;
    assert.equal(response.status, 200);
    const result = await response.json() as { body: { text: string } };
    assert.deepEqual(result.body, { text: payloads[i]!.text });
  }
});


test('reproduces a short server deadline poisoning a late successful metered result', async () => {
  const meta = envelope();
  const app = new Hono();
  let calls = 0;
  let finished!: () => void;
  const completed = new Promise<void>(resolve => { finished = resolve; });
  app.use('*', timeout(25));
  app.use('*', async (_c, next) => { try { await next(); } finally { finished(); } });
  app.post('/internal/classify', internalAuth, meteredRequestMiddleware, async c => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 100));
    return c.json({ assignments: [] });
  });
  const run = () => app.request('/internal/classify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': httpToken }, body: JSON.stringify({ _metering: meta }) });
  const first = await run();
  assert.equal(first.status, 504);
  await first.text(); // HTTP server consumes the timeout response while generation continues.
  await completed;
  const replay = await run();
  assert.equal(replay.status, 502);
  assert.equal((await replay.json() as { error: string }).error, 'metered_execution_failed');
  assert.equal(calls, 1);
});


test('aligned server deadline preserves a slow result and replay without another model call', async () => {
  const meta = envelope();
  const app = new Hono();
  const configured = loadConfig({ AI_RUNTIME_REQUEST_TIMEOUT_MS: '1000', AI_MODEL_HTTP_TIMEOUT_MS: '900' });
  let calls = 0;
  app.use('*', timeout(configured.requestTimeoutMs));
  app.post('/internal/classify', internalAuth, meteredRequestMiddleware, async c => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 100));
    return c.json({ assignments: [] });
  });
  const run = () => app.request('/internal/classify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': httpToken }, body: JSON.stringify({ _metering: meta }) });
  const first = await run();
  assert.equal(first.status, 200);
  const result = await first.json();
  const replay = await run();
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), result);
  assert.equal(calls, 1);
});
