type Environment = Readonly<Record<string, string | undefined>>;
export const PROXY_MODELS = { eco: 'openai/primary-eco', standard: 'openai/primary-standard', flagship: 'openai/primary-flagship' } as const;
export function proxyBands(env: Environment): Set<string> {
  if (env.AI_MODEL_ROUTING_MODE?.trim() !== 'litellm') return new Set(['flagship']);
  const bands = (env.AI_PROXY_BANDS ?? 'eco,standard,flagship').split(',').map(s => s.trim());
  if (bands.some(b => !Object.hasOwn(PROXY_MODELS, b)) || new Set(bands).size !== bands.length || !bands.includes('flagship')) {
    throw new Error('AI_PROXY_BANDS must contain unique eco/standard/flagship bands including flagship');
  }
  return new Set(bands);
}
export function litellmConfig(env: Environment) {
  const selected = proxyBands(env);
  if (env.AI_PROXY_MODEL_PROFILE && env.AI_PROXY_MODEL_PROFILE !== 'onetoken') throw new Error('Unknown proxy model profile');
  if (env.AI_PROXY_MODEL_PROFILE === 'onetoken' && selected.size !== 3) throw new Error('1Token profile requires all three proxy bands');
  if (!env.OPENAI_API_KEY?.trim()) throw new Error('Missing required env var: OPENAI_API_KEY');
  const root = new URL(env.OPENAI_BASE_URL ?? '');
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || !root.pathname.replace(/\/$/, '').endsWith('/v1') || (root.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(root.hostname))) {
    throw new Error('LiteLLM requires a credential-free /v1 API root and HTTPS outside loopback');
  }
  for (const [band, key] of [['eco', 'DEEPSEEK_API_KEY'], ['standard', 'ZAI_API_KEY']]) {
    if (!selected.has(band!) && !env[key!]?.trim()) throw new Error(`Missing required env var: ${key}`);
  }
  // Explicit profile: ignore legacy aliases and never silently change models on failure.
  return { models: { ...PROXY_MODELS }, fallbackModels: { ...PROXY_MODELS }, openAiBaseUrl: root.toString() };
}
export function usesJsonObject(model: string, env: Environment = process.env): boolean {
  if (!['three-channel', 'litellm'].includes(env.AI_MODEL_ROUTING_MODE?.trim() ?? '')) return false;
  const id = model.replace(/^openai\//, '');
  return ['deepseek-flash', 'glm-5.3-flash', 'primary-eco', 'primary-standard'].includes(id) || (env.AI_MODEL_ROUTING_MODE === 'litellm' && env.AI_PROXY_MODEL_PROFILE === 'onetoken' && id === 'primary-flagship');
}
