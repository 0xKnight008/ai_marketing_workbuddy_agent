/**
 * 环境配置集中解析。ai-runtime 不持有任何 connector 凭证 / 组织记忆（§3.5），
 * 这里只允许出现 LLM、内部鉴权、回调投递三类配置。
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function port(name: string, fallback: number): number {
  const value = positiveInteger(name, fallback);
  if (value > 65_535) throw new Error(`${name} must be between 1 and 65535`);
  return value;
}

function callbackUrl(): string {
  const value =
    process.env.RUN_SERVICE_CALLBACK_URL ??
    'http://localhost:4102/internal/ai-runtime-events';
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RUN_SERVICE_CALLBACK_URL must use http or https');
  }
  return url.toString();
}

const storageUrl = required('MASTRA_STORAGE_URL', 'file:./.mastra/mastra.db');
if (process.env.NODE_ENV === 'production' && storageUrl.startsWith('file:')) {
  throw new Error('MASTRA_STORAGE_URL must use a shared LibSQL endpoint in production');
}

export const config = {
  model: process.env.AI_MODEL ?? 'openai/gpt-4o-mini',

  internalApiToken: process.env.INTERNAL_API_TOKEN ?? '',

  runServiceCallbackUrl: callbackUrl(),

  eventCallbackSigningSecret: process.env.EVENT_CALLBACK_SIGNING_SECRET ?? '',
  eventCallbackMaxRetries: positiveInteger('EVENT_CALLBACK_MAX_RETRIES', 3),
  eventCallbackTimeoutMs: positiveInteger('EVENT_CALLBACK_TIMEOUT_MS', 5000),

  port: port('PORT', 4111),
  studioEnabled: process.env.MASTRA_STUDIO_ENABLED === 'true',

  storageUrl,
  storageAuthToken: process.env.MASTRA_STORAGE_AUTH_TOKEN,
  runRegistryRetentionMs: positiveInteger('RUN_REGISTRY_RETENTION_MS', 86_400_000),
} as const;

export type AppConfig = typeof config;
