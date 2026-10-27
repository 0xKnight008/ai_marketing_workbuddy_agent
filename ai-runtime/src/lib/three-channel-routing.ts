import { PROXY_MODELS, proxyBands } from './litellm-routing';
/** Opt-in channel profile. Logical aliases are never sent to official APIs. */
type Environment = Readonly<Record<string, string | undefined>>;
export const THREE_CHANNEL_MODELS = {
  eco: 'openai/piggy-deepseek-eco',
  standard: 'openai/piggy-glm-standard',
} as const;
export const THREE_CHANNEL_ECO_FALLBACK = 'openai/piggy-deepseek-eco-fallback';

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function threeChannelConfig(env: Environment) {
  const flagship = required(env, 'AI_MODEL_FLAGSHIP');
  if (!flagship.startsWith('openai/') || flagship.slice(7).trim().length === 0) {
    throw new Error('AI_MODEL_FLAGSHIP must use openai/<existing-1token-router-alias>');
  }
  if (new Set<string>([...Object.values(THREE_CHANNEL_MODELS), THREE_CHANNEL_ECO_FALLBACK]).has(flagship)) {
    throw new Error('AI_MODEL_FLAGSHIP must not reuse an official-channel alias');
  }
  const baseUrl = required(env, 'OPENAI_BASE_URL');
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.replace(/\/$/, '').endsWith('/v1')) {
    throw new Error('OPENAI_BASE_URL must be a credential-free routing proxy API root ending in /v1');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Three-channel proxy connections require HTTPS except on loopback');
  }
  // Validate every channel at startup, not halfway through a paid workflow.
  required(env, 'OPENAI_API_KEY');
  required(env, 'DEEPSEEK_API_KEY');
  required(env, 'ZAI_API_KEY');
  return {
    models: { ...THREE_CHANNEL_MODELS, flagship },
    // Only Eco fallback is selected by the existing degraded guardrail. Other
    // bands stay on their chosen channel; no implicit quality/outage switching.
    fallbackModels: { eco: THREE_CHANNEL_ECO_FALLBACK, standard: THREE_CHANNEL_MODELS.standard, flagship },
    openAiBaseUrl: url.toString(),
  };
}

export function officialChannelModel(model: string, env: Environment) {
  if (env.AI_MODEL_ROUTING_MODE?.trim() === 'litellm') {
    const band = Object.entries(PROXY_MODELS).find(([, alias]) => alias === model)?.[0];
    if (!band) throw new Error('Unknown model alias in LiteLLM mode');
    if (proxyBands(env).has(band)) return undefined;
    if (band === 'eco') return { id: 'openai/deepseek-flash' as const, url: 'https://api.deepseek.com/v1', apiKey: required(env, 'DEEPSEEK_API_KEY') };
    return { id: 'openai/glm-5.3-flash' as const, url: 'https://api.z.ai/api/paas/v4', apiKey: required(env, 'ZAI_API_KEY') };
  }
  if (env.AI_MODEL_ROUTING_MODE?.trim() !== 'three-channel') return undefined;
  if (model === THREE_CHANNEL_MODELS.eco || model === THREE_CHANNEL_ECO_FALLBACK) {
    return { id: 'openai/deepseek-flash' as const, url: 'https://api.deepseek.com/v1', apiKey: required(env, 'DEEPSEEK_API_KEY') };
  }
  if (model === THREE_CHANNEL_MODELS.standard) {
    return { id: 'openai/glm-5.3-flash' as const, url: 'https://api.z.ai/api/paas/v4', apiKey: required(env, 'ZAI_API_KEY') };
  }
  if (model !== required(env, 'AI_MODEL_FLAGSHIP')) {
    throw new Error('Unknown model alias in three-channel mode');
  }
  return undefined; // Flagship preserves the existing proxy transport.
}
