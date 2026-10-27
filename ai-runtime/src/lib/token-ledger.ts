import { runtimeCostContext } from './cost-metering';
import { randomUUID } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { config } from '../config';
import { officialChannelModel } from './three-channel-routing';

// Separate from the expiring run registry: no prompts, outputs, keys or headers.
export function createTokenLedger(client: Client) {
  let ready: Promise<unknown> | undefined;
  async function initialize() {
    ready ??= client.execute(`CREATE TABLE IF NOT EXISTS ai_token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, run_id TEXT, operation TEXT NOT NULL,
      provider TEXT NOT NULL, requested_model TEXT NOT NULL, model_name TEXT NOT NULL,
      response_id TEXT, prompt_tokens INTEGER, completion_tokens INTEGER,
      reasoning_tokens INTEGER, cached_input_tokens INTEGER, finish_reason TEXT
    )`).catch(error => { ready = undefined; throw error; });
    await ready;
  }
  return {
    async record(row: Record<string, string | number | null>) {
      await initialize();
      const fields = ['event_id', 'created_at', 'run_id', 'operation', 'provider', 'requested_model', 'model_name', 'response_id', 'prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cached_input_tokens', 'finish_reason'];
      await client.execute({ sql: `INSERT INTO ai_token_usage (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')}) ON CONFLICT(event_id) DO NOTHING`, args: fields.map(field => row[field] ?? null) });
    },
    async list(before: number, q: string) {
      await initialize();
      const result = await client.execute({ sql: `SELECT *, prompt_tokens + completion_tokens AS total_tokens FROM ai_token_usage WHERE id < ? AND (? = '' OR instr(model_name, ?) > 0 OR instr(provider, ?) > 0 OR instr(run_id, ?) > 0) ORDER BY id DESC LIMIT 100`, args: [before, q, q, q, q] });
      return result.rows;
    },
  };
}

const ledger = createTokenLedger(createClient({ url: config.storageUrl, authToken: config.storageAuthToken }));
export const listTokenUsage = ledger.list;

export function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

interface StepUsage {
  runId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number };
  response?: { id?: string; modelId?: string };
  finishReason?: string;
}

export function tokenUsageOptions(model: string, operation: string, store = ledger, env = process.env, contextRunId?: string) {
  const official = officialChannelModel(model, env);
  const provider = official ? (official.url.includes('deepseek.com') ? 'deepseek' : 'zai') : 'configured-proxy';
  return {
    modelSettings: { maxRetries: 0, ...(runtimeCostContext.getStore() && !runtimeCostContext.getStore()!.shadow ? { maxOutputTokens: runtimeCostContext.getStore()!.maxOutputTokens } : {}) },
    // Per completed model step, not both usage and totalUsage (which double-counts).
    // This also captures tokens from steps whose structured result later fails validation.
    onStepFinish: async (event: StepUsage) => {
      await store.record({
        event_id: randomUUID(), created_at: new Date().toISOString(),
        run_id: contextRunId ?? event.runId ?? null, operation, provider, requested_model: model,
        model_name: event.response?.modelId ?? official?.id.replace(/^openai\//, '') ?? model,
        response_id: event.response?.id ?? null,
        prompt_tokens: tokenCount(event.usage?.inputTokens), completion_tokens: tokenCount(event.usage?.outputTokens),
        reasoning_tokens: tokenCount(event.usage?.reasoningTokens), cached_input_tokens: tokenCount(event.usage?.cachedInputTokens),
        finish_reason: event.finishReason ?? null,
      });
    },
  };
}
