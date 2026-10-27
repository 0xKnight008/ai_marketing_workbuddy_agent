import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { config } from '../config';
import { usesJsonObject } from './litellm-routing';

const uuid = (v: unknown): string | null => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v) ? v : null;
const safeId = (v: unknown): string | null => typeof v === 'string' && /^[a-zA-Z0-9_.:/-]{1,150}$/.test(v) ? v : null;
const finishes = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'error', 'function_call']);
type Trace = { id?: string; status?: number; persist?: () => Promise<void>; requestId: string; taskId: string | null; workspaceId: string | null; operationId: string | null; band: string | null; failureCode?: string; issues?: string[]; attempts: Record<string, unknown>[] };
export const requestTraceContext = new AsyncLocalStorage<Trace>();
export function createTraceStore(client: Client) {
  let ready: Promise<unknown> | undefined;
  const initialize = () => ready ??= (async () => { await client.execute(`CREATE TABLE IF NOT EXISTS ai_request_trace (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, task_id TEXT, operation_id TEXT, workspace_id TEXT,
    created_at TEXT NOT NULL, details TEXT NOT NULL
  )`);
    for (const column of ['request_id', 'task_id', 'operation_id']) await client.execute(`CREATE INDEX IF NOT EXISTS ai_request_trace_${column} ON ai_request_trace(${column},created_at)`);
  })().catch(error => { ready = undefined; throw error; });
  return {
    async record(trace: Trace, status: number) {
      await initialize();
      await client.execute({ sql: 'INSERT INTO ai_request_trace VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET details=excluded.details', args: [trace.id ??= randomUUID(), trace.requestId, trace.taskId, trace.operationId, trace.workspaceId, new Date().toISOString(), JSON.stringify({ band: trace.band, status, failureCode: trace.failureCode ?? null, issues: trace.issues ?? [], attempts: trace.attempts })] });
    },
    async list(id: string) {
      if (!uuid(id)) throw new Error('invalid_trace_id');
      await initialize();
      const rows = await client.execute({ sql: 'SELECT * FROM ai_request_trace WHERE request_id=? OR task_id=? OR operation_id=? ORDER BY created_at DESC LIMIT 100', args: [id, id, id] });
      return rows.rows.map(r => ({ ...r, details: JSON.parse(String(r.details)) }));
    },
  };
}
const store = createTraceStore(createClient({ url: config.storageUrl, authToken: config.storageAuthToken }));
export const listRequestTraces = store.list;
export function markTaskFailure(code: string, issues: string[] = []) {
  const trace = requestTraceContext.getStore();
  if (trace) { trace.failureCode = code; trace.issues = issues; }
}
/** Runs after internal authentication, outside metering so cached failures retain correlation. */
export const requestTraceMiddleware = async (c: any, next: () => Promise<void>) => {
  if (c.req.method !== 'POST') return next();
  let body: any; try { body = await c.req.json(); } catch { return next(); }
  const trace: Trace = { requestId: uuid(body?._metering?.requestId) ?? randomUUID(), taskId: uuid(body?.taskId), workspaceId: uuid(body?._metering?.workspaceId), operationId: uuid(body?._metering?.operationId), band: ['eco', 'standard', 'flagship'].includes(body?.modelBand) ? body.modelBand : null, attempts: [] };
  trace.persist = async () => {
    try { await store.record(trace, trace.status ?? 202); } catch { console.warn('runtime_request_trace_write_failed'); }
  };
  return requestTraceContext.run(trace, async () => {
    try { await next(); } finally {
      c.header('x-piggybot-request-id', trace.requestId);
      trace.status = c.res.status;
      await trace.persist!();
    }
  });
};
/** Whitelisted metadata only; never persist prompts, response bodies, keys, or raw errors. */
export async function tracedModelFetch(fetcher: typeof fetch, input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  if (!String(input).endsWith('/chat/completions') || init?.method?.toUpperCase() !== 'POST') return fetcher(input, init);
  const body = JSON.parse(String(init.body));
  const trace = requestTraceContext.getStore();
  if (usesJsonObject(body.model)) {
    body.response_format = { type: 'json_object' };
    delete body.strictJsonSchema;
  }
  if (trace && process.env.AI_MODEL_ROUTING_MODE === 'litellm' && ['primary-eco', 'primary-standard', 'primary-flagship'].includes(body.model)) {
    body.metadata = { ...(body.metadata ?? {}), piggybot_request_id: trace.requestId, piggybot_task_id: trace.taskId, piggybot_operation_id: trace.operationId };
  }
  const started = Date.now();
  const attempt: Record<string, unknown> = { model: safeId(body.model), startedAt: new Date(started).toISOString() };
  trace?.attempts.push(attempt);
  try {
    const response = await fetcher(input, { ...init, body: JSON.stringify(body) });
    attempt.httpStatus = response.status;
    attempt.proxyCallId = safeId(response.headers.get('x-litellm-call-id'));
    // generate() is non-streaming. Do not consume a streaming body just to trace it.
    if (!body.stream) {
      let data: any; try { data = await response.clone().json(); } catch { data = {}; }
      const choice = data.choices?.[0];
      attempt.finishReason = finishes.has(choice?.finish_reason) ? choice.finish_reason : 'unknown';
      attempt.responseId = safeId(data.id);
      attempt.returnedModel = safeId(data.model);
      attempt.contentChars = typeof choice?.message?.content === 'string' ? choice.message.content.length : 0;
      attempt.hasReasoning = Boolean(choice?.message?.reasoning_content || choice?.message?.reasoning);
    }
    return response;
  } catch (error) { attempt.transportError = true; throw error; }
  finally {
    attempt.durationMs = Date.now() - started;
    // Background announcement workflows can outlive the accepted HTTP request.
    await trace?.persist?.();
  }
}
