import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const directory = mkdtempSync(join(tmpdir(), "piggy-metering-runtime-"));
process.env.MASTRA_STORAGE_URL = "file:" + join(directory, "metering.db");
after(() => rmSync(directory, { recursive: true, force: true }));
const {
  runtimeCostContext,
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
      json: async () => payload,
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
