import { Agent } from 'undici';
import { tracedModelFetch, markTaskFailure } from './request-trace';
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { config } from "../config";
import {
  usageCostNanos,
  decimalNanos,
  validateRate,
  rateForTime,
  type MeterEnvelope,
  type Receipt,
} from "../../../shared/ai-metering";

const client = createClient({
  url: config.storageUrl,
  authToken: config.storageAuthToken,
});
export const runtimeCostContext = new AsyncLocalStorage<MeterEnvelope>();
const runtimeBusinessBody = new AsyncLocalStorage<unknown>();
/** Read the authenticated business body without relying on framework body caches. */
export async function readRuntimeRequestBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  const business = runtimeBusinessBody.getStore();
  return business === undefined ? c.req.json() : business;
}
let ready: Promise<unknown> | undefined;
function initialize() {
  return (ready ??= (async () => {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS ai_metered_request(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,operation_id TEXT NOT NULL,fingerprint TEXT NOT NULL,envelope TEXT NOT NULL,state TEXT NOT NULL,body TEXT,status INTEGER,run_id TEXT,created_at TEXT NOT NULL)`,
    );
    await client.execute(
      `CREATE TABLE IF NOT EXISTS ai_metered_attempt(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,workspace_id TEXT NOT NULL,operation_id TEXT NOT NULL,max_cost_nanos TEXT NOT NULL,cost_nanos TEXT,state TEXT NOT NULL,receipt TEXT,created_at TEXT NOT NULL)`,
    );
  })().catch((e) => {
    ready = undefined;
    throw e;
  }));
}
export async function requestReceipts(requestId: string): Promise<Receipt[]> {
  await initialize();
  const rows = await client.execute({
    sql: "SELECT receipt FROM ai_metered_attempt WHERE request_id=? AND receipt IS NOT NULL ORDER BY created_at,id",
    args: [requestId],
  });
  return rows.rows.map((r) => JSON.parse(String(r.receipt)));
}
function envelopeValue(value: unknown): MeterEnvelope {
  const m = value as MeterEnvelope;
  if (
    !m ||
    ![m.workspaceId, m.operationId, m.requestId].every(
      (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v),
    ) ||
    !/^\d+$/.test(m.maxCostNanos) ||
    BigInt(m.maxCostNanos) <= 0n ||
    ![m.maxInputTokens, m.maxOutputTokens].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 1000000,
    )
  )
    throw new Error("invalid_metering_envelope");
  validateRate(m.rate);
  return m;
}
/** Auth middleware runs BEFORE this. The envelope comes only from Platform. */
export const meteredRequestMiddleware = async (
  c: any,
  next: () => Promise<void>,
) => {
  if (c.req.method !== "POST") {
    await next();
    if (c.req.method === "GET" && c.req.path.startsWith("/internal/ai-runs/")) {
      await initialize();
      const r = await client.execute({
        sql: "SELECT id,envelope FROM ai_metered_request WHERE run_id=?",
        args: [c.req.path.split("/").pop()],
      });
      if (r.rows[0]) {
        const body = await c.res.clone().json();
        body._metering = await requestReceipts(String(r.rows[0].id));
        body._meteringOperationId = JSON.parse(
          String(r.rows[0].envelope),
        ).operationId;
        c.res = Response.json(body, { status: c.res.status });
      }
    }
    return;
  }
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return next();
  }
  if (!body?._metering) return next();
  let envelope: MeterEnvelope;
  try {
    envelope = envelopeValue(body._metering);
  } catch {
    return c.json({ error: "invalid_metering_envelope" }, 400);
  }
  await initialize();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  const inserted = await client.execute({
    sql: `INSERT OR IGNORE INTO ai_metered_request(id,workspace_id,operation_id,fingerprint,envelope,state,created_at) VALUES(?,?,?,?,?,'running',?)`,
    args: [
      envelope.requestId,
      envelope.workspaceId,
      envelope.operationId,
      fingerprint,
      JSON.stringify(envelope),
      new Date().toISOString(),
    ],
  });
  if (!inserted.rowsAffected) {
    const saved = await client.execute({
      sql: "SELECT * FROM ai_metered_request WHERE id=?",
      args: [envelope.requestId],
    });
    const row = saved.rows[0];
    if (
      !row ||
      row.fingerprint !== fingerprint ||
      row.workspace_id !== envelope.workspaceId
    )
      return c.json({ error: "metering_request_conflict" }, 409);
    if (row.state !== "completed")
      return c.json({ error: "metering_request_pending" }, 409);
    const result = JSON.parse(String(row.body));
    result._metering = await requestReceipts(envelope.requestId);
    return c.json(result, Number(row.status));
  }
  // Hash/claim includes the entire transport envelope; business schemas must
  // receive only the validated business body, including through Mastra wrappers.
  const businessBody = { ...body };
  delete businessBody._metering;
  return runtimeBusinessBody.run(businessBody, () => runtimeCostContext.run(envelope, async () => {
    let stage: 'handler' | 'response' | 'receipts' | 'cache' = 'handler';
    try {
      await next();
      stage = 'response';
      const result = await c.res.clone().json();
      if (envelope.guardError) {
        result.error = envelope.guardError;
        c.res = Response.json(result, { status: 409 });
      }
      stage = 'receipts';
      result._metering = await requestReceipts(envelope.requestId);
      stage = 'cache';
      await client.execute({
        sql: `UPDATE ai_metered_request SET state='completed',body=?,status=?,run_id=? WHERE id=?`,
        args: [
          JSON.stringify(result),
          c.res.status,
          result.aiRunId ?? null,
          envelope.requestId,
        ],
      });
      c.res = Response.json(result, { status: c.res.status });
    } catch {
      markTaskFailure(`metered_${stage}_failed`);
      const result = {
        error: "metered_execution_failed",
        stage,
        _metering: await requestReceipts(envelope.requestId),
      };
      await client.execute({
        sql: `UPDATE ai_metered_request SET state='completed',body=?,status=502 WHERE id=?`,
        args: [JSON.stringify(result), envelope.requestId],
      });
      c.res = Response.json(result, { status: 502 });
    }
  }));
};
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
export async function boundedModelFetch(
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const meta = runtimeCostContext.getStore();
  const target = String(input);
  if (
    !meta ||
    !target.endsWith("/chat/completions") ||
    init?.method?.toUpperCase() !== "POST"
  )
    return fetcher(input, init);
  const body = JSON.parse(String(init.body));
  const startedAt = new Date().toISOString();
  if (!meta.shadow) rateForTime(meta.rate, startedAt);
  if (!meta.shadow && body.model !== meta.rate.model)
    throw new Error("metered_model_mismatch");
  if (body.stream) throw new Error("metered_stream_not_supported"); // Agent.generate uses non-streaming; do not guess partial usage.
  const bytes =
    Buffer.byteLength(
      JSON.stringify({
        messages: body.messages,
        tools: body.tools,
        response_format: body.response_format,
      }),
      "utf8",
    ) +
    64 * (body.messages?.length ?? 1);
  if (!meta.shadow && bytes > meta.maxInputTokens)
    throw new Error("ai_input_exceeds_confirmed_limit");
  // Only the configured proxy alias needs these compatibility changes. Native
  // json_schema and application-side result validation remain intact.
  if (!meta.shadow && body.model === "primary-flagship") {
    delete body.strictJsonSchema;
    delete body.temperature;
  }
  await initialize();
  const transaction = await client.transaction("write");
  let attemptId: string, maxCost: bigint;
  try {
    const rows = await transaction.execute({
      sql: "SELECT max_cost_nanos,cost_nanos,state FROM ai_metered_attempt WHERE request_id=?",
      args: [meta.requestId],
    });
    const used = rows.rows.reduce(
      (sum, r) => sum + BigInt(String(r.cost_nanos ?? r.max_cost_nanos)),
      0n,
    );
    const remaining = meta.shadow
      ? 1000000000000n
      : BigInt(meta.maxCostNanos) - used;
    const inputCost = usageCostNanos(meta.rate, {
      input: bytes,
      output: 0,
      cached: 0,
    });
    const outputRate = [
      meta.rate.outputUsdPerMillion,
      ...(meta.rate.periods ?? []).map((p) => p.outputUsdPerMillion),
    ]
      .map(decimalNanos)
      .reduce((a, b) => (a > b ? a : b));
    const affordable = ((remaining - inputCost) * 1000000n) / outputRate;
    const output = Math.min(
      meta.maxOutputTokens,
      Number(affordable),
      Number(
        body.max_tokens ?? body.max_completion_tokens ?? meta.maxOutputTokens,
      ),
    );
    if (output < 1) {
      meta.guardError = "ai_confirmed_budget_exhausted";
      throw new Error("ai_confirmed_budget_exhausted");
    }
    if (!meta.shadow) {
      delete body.max_completion_tokens;
      body.max_tokens = output;
    }
    maxCost = usageCostNanos(meta.rate, { input: bytes, output, cached: 0 });
    attemptId = randomUUID();
    await transaction.execute({
      sql: `INSERT INTO ai_metered_attempt(id,request_id,workspace_id,operation_id,max_cost_nanos,state,created_at) VALUES(?,?,?,?,?,'pending',?)`,
      args: [
        attemptId,
        meta.requestId,
        meta.workspaceId,
        meta.operationId,
        maxCost.toString(),
        new Date().toISOString(),
      ],
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  let response: Response;
  try {
    response = await fetcher(input, { ...init, body: JSON.stringify(body) });
  } catch (error) {
    const receipt = {
      id: attemptId!,
      requestId: meta.requestId,
      operationId: meta.operationId,
      workspaceId: meta.workspaceId,
      model: body.model,
      input: null,
      output: null,
      cached: null,
      costNanos: null,
      status: "unknown",
    };
    await client.execute({
      sql: `UPDATE ai_metered_attempt SET state='unknown',receipt=? WHERE id=?`,
      args: [JSON.stringify(receipt), attemptId!],
    });
    throw error;
  }
  let data: any;
  try {
    data = await response.clone().json();
  } catch {
    data = {};
  }
  const usage = data.usage ?? {},
    prompt = count(usage.prompt_tokens),
    completion = count(usage.completion_tokens);
  const cached = count(
    usage.prompt_tokens_details?.cached_tokens ??
      usage.prompt_cache_hit_tokens ??
      0,
  );
  const model = typeof data.model === "string" ? data.model : body.model;
  const known =
    prompt !== null &&
    completion !== null &&
    cached !== null &&
    cached <= prompt &&
    meta.rate.responseModels.includes(model);
  let cost: bigint | null = null;
  try {
    if (known)
      cost = usageCostNanos(
        meta.rate,
        { input: prompt!, output: completion!, cached: cached! },
        startedAt,
      );
  } catch {
    /* Expired shadow tariffs remain unknown, without affecting legacy execution. */
  }
  const priced = cost !== null;
  const receipt = {
    id: attemptId!,
    requestId: meta.requestId,
    operationId: meta.operationId,
    workspaceId: meta.workspaceId,
    model,
    startedAt,
    input: prompt,
    output: completion,
    cached,
    costNanos: cost?.toString() ?? null,
    status: priced ? "known" : "unknown",
  };
  await client.execute({
    sql: `UPDATE ai_metered_attempt SET cost_nanos=?,state=?,receipt=? WHERE id=?`,
    args: [
      cost?.toString() ?? null,
      priced ? "known" : "unknown",
      JSON.stringify(receipt),
      attemptId!,
    ],
  });
  return response;
}
let installed = false;
export function installMeteredFetch() {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  // A longer AbortSignal alone does not override native fetch's header/body timers.
  // Scope the dispatcher to model requests; storage/callback transports keep their own policy.
  const dispatcher = new Agent({ headersTimeout: config.modelHttpTimeoutMs, bodyTimeout: config.modelHttpTimeoutMs });
  const modelFetch: typeof fetch = (input, init) => original(input, {
    ...init,
    dispatcher,
    signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(config.modelHttpTimeoutMs)]),
  } as unknown as RequestInit);
  globalThis.fetch = (input, init) => {
    if (!String(input).endsWith('/chat/completions') || init?.method?.toUpperCase() !== 'POST') return original(input, init);
    return tracedModelFetch((target, options) => boundedModelFetch(modelFetch, target, options), input, init);
  };
}
