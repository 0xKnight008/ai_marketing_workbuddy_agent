/**
 * 环境配置集中解析。ai-runtime 不持有任何 connector 凭证 / 组织记忆（§3.5），
 * 这里只允许出现 LLM、内部鉴权、回调投递三类配置。
 */

type Environment = Readonly<Record<string, string | undefined>>;
type ModelBand = 'eco' | 'standard' | 'flagship';

const MODEL_BANDS: readonly ModelBand[] = ['eco', 'standard', 'flagship'];

function optional(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function required(env: Environment, name: string, fallback?: string): string {
  const value = optional(env, name) ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function positiveInteger(env: Environment, name: string, fallback: number): number {
  const raw = optional(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function port(env: Environment, name: string, fallback: number): number {
  const value = positiveInteger(env, name, fallback);
  if (value > 65_535) throw new Error(`${name} must be between 1 and 65535`);
  return value;
}

function httpUrl(env: Environment, name: string, fallback?: string): string {
  const value = required(env, name, fallback);
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials`);
  }
  return url.toString();
}

function routingMode(env: Environment): 'direct' | 'proxy' {
  const value = optional(env, 'AI_MODEL_ROUTING_MODE') ?? 'direct';
  if (value !== 'direct' && value !== 'proxy') {
    throw new Error('AI_MODEL_ROUTING_MODE must be direct or proxy');
  }
  return value;
}

function assertProxyRouting(
  env: Environment,
  mode: 'direct' | 'proxy',
  models: Readonly<Record<ModelBand, string>>,
  fallbackModels: Readonly<Record<ModelBand, string | undefined>>,
): string | undefined {
  if (env.NODE_ENV === 'production' && mode !== 'proxy') {
    throw new Error(
      'AI_MODEL_ROUTING_MODE=proxy is required in production so primary and fallback suppliers share one OpenAI-compatible endpoint',
    );
  }
  if (mode !== 'proxy') return optional(env, 'OPENAI_BASE_URL');

  required(env, 'OPENAI_API_KEY');
  const baseUrl = httpUrl(env, 'OPENAI_BASE_URL');
  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new Error('OPENAI_BASE_URL must not contain a query string or fragment');
  }
  if (!parsedBaseUrl.pathname.replace(/\/$/, '').endsWith('/v1')) {
    throw new Error('OPENAI_BASE_URL must point to the routing proxy OpenAI API root ending in /v1');
  }

  for (const band of MODEL_BANDS) {
    const primary = models[band];
    const fallback = fallbackModels[band];
    const fallbackEnvName = `AI_MODEL_${band.toUpperCase()}_FALLBACK`;
    if (!fallback) {
      throw new Error(`Missing required env var: ${fallbackEnvName}`);
    }
    if (!primary.startsWith('openai/') || !fallback.startsWith('openai/')) {
      throw new Error(
        `Proxy-routed ${band} models must use openai/<router-alias> model ids`,
      );
    }
    if (primary === fallback) {
      throw new Error(`Primary and fallback ${band} model aliases must be different`);
    }
  }

  return baseUrl;
}

export function loadConfig(env: Environment = process.env) {
  const models = {
    eco: optional(env, 'AI_MODEL_ECO') ?? optional(env, 'AI_MODEL') ?? 'openai/gpt-4o-mini',
    standard: optional(env, 'AI_MODEL_STANDARD') ?? 'openai/gpt-4o',
    flagship: optional(env, 'AI_MODEL_FLAGSHIP') ?? 'openai/o3',
  } as const;
  const fallbackModels = {
    eco: optional(env, 'AI_MODEL_ECO_FALLBACK'),
    standard: optional(env, 'AI_MODEL_STANDARD_FALLBACK'),
    flagship: optional(env, 'AI_MODEL_FLAGSHIP_FALLBACK'),
  } as const;
  const modelRoutingMode = routingMode(env);
  const openAiBaseUrl = assertProxyRouting(env, modelRoutingMode, models, fallbackModels);

  const storageUrl = required(env, 'MASTRA_STORAGE_URL', 'file:./mastra.db');
  if (env.NODE_ENV === 'production' && storageUrl.startsWith('file:')) {
    throw new Error('MASTRA_STORAGE_URL must use a shared LibSQL endpoint in production');
  }

  return {
    models,
    fallbackModels,
    modelRoutingMode,
    openAiBaseUrl,

    internalApiToken: optional(env, 'INTERNAL_API_TOKEN') ?? '',

    runServiceCallbackUrl: httpUrl(
      env,
      'RUN_SERVICE_CALLBACK_URL',
      'http://localhost:4102/internal/ai-runtime-events',
    ),

    eventCallbackSigningSecret: optional(env, 'EVENT_CALLBACK_SIGNING_SECRET') ?? '',
    eventCallbackMaxRetries: positiveInteger(env, 'EVENT_CALLBACK_MAX_RETRIES', 3),
    eventCallbackTimeoutMs: positiveInteger(env, 'EVENT_CALLBACK_TIMEOUT_MS', 5000),

    port: port(env, 'PORT', 4111),

    storageUrl,
    storageAuthToken: optional(env, 'MASTRA_STORAGE_AUTH_TOKEN'),
    runRegistryRetentionMs: positiveInteger(env, 'RUN_REGISTRY_RETENTION_MS', 86_400_000),
  } as const;
}

export const config = loadConfig();

export type AppConfig = ReturnType<typeof loadConfig>;
