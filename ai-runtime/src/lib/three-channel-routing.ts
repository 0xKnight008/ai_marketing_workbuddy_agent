import { PROXY_MODELS, proxyBands } from './litellm-routing';
import { KIMI_WIRE_MODEL } from './model-constants';

/** Opt-in channel profile. Logical aliases are never sent to official APIs. */
type Environment = Readonly<Record<string, string | undefined>>;

export const THREE_CHANNEL_MODELS = {
  eco: 'openai/piggy-deepseek-eco',
  standard: 'openai/piggy-glm-standard',
  flagship: 'openai/piggy-kimi-flagship',
} as const;
export const THREE_CHANNEL_ECO_FALLBACK = 'openai/piggy-deepseek-eco-fallback';

type OfficialChannel = {
  id: `openai/${string}`;
  url: string;
  apiKey: string;
  provider: 'deepseek' | 'zai' | 'moonshot';
};

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function threeChannelConfig(env: Environment) {
  // Validate every channel at startup, not halfway through a paid workflow.
  required(env, 'DEEPSEEK_API_KEY');
  required(env, 'ZAI_API_KEY');
  required(env, 'MOONSHOT_API_KEY');
  return {
    models: { ...THREE_CHANNEL_MODELS },
    // Only Eco fallback is selected by the existing degraded guardrail. Other
    // bands stay on their chosen channel; no implicit quality/outage switching.
    fallbackModels: {
      eco: THREE_CHANNEL_ECO_FALLBACK,
      standard: THREE_CHANNEL_MODELS.standard,
      flagship: THREE_CHANNEL_MODELS.flagship,
    },
    // All three bands resolve to official endpoints locally, so no proxy root
    // is part of this profile.
    openAiBaseUrl: undefined,
  };
}

export function officialChannelModel(model: string, env: Environment): OfficialChannel | undefined {
  if (env.AI_MODEL_ROUTING_MODE?.trim() === 'litellm') {
    const band = Object.entries(PROXY_MODELS).find(([, alias]) => alias === model)?.[0];
    if (!band) throw new Error('Unknown model alias in LiteLLM mode');
    if (proxyBands(env).has(band)) return undefined;
    if (band === 'eco') return { id: 'openai/deepseek-flash', url: 'https://api.deepseek.com/v1', apiKey: required(env, 'DEEPSEEK_API_KEY'), provider: 'deepseek' };
    return { id: 'openai/glm-5.3-flash', url: 'https://api.z.ai/api/paas/v4', apiKey: required(env, 'ZAI_API_KEY'), provider: 'zai' };
  }
  if (env.AI_MODEL_ROUTING_MODE?.trim() !== 'three-channel') return undefined;
  if (model === THREE_CHANNEL_MODELS.eco || model === THREE_CHANNEL_ECO_FALLBACK) {
    return { id: 'openai/deepseek-flash', url: 'https://api.deepseek.com/v1', apiKey: required(env, 'DEEPSEEK_API_KEY'), provider: 'deepseek' };
  }
  if (model === THREE_CHANNEL_MODELS.standard) {
    return { id: 'openai/glm-5.3-flash', url: 'https://api.z.ai/api/paas/v4', apiKey: required(env, 'ZAI_API_KEY'), provider: 'zai' };
  }
  if (model === THREE_CHANNEL_MODELS.flagship) {
    return { id: `openai/${KIMI_WIRE_MODEL}`, url: 'https://api.moonshot.ai/v1', apiKey: required(env, 'MOONSHOT_API_KEY'), provider: 'moonshot' };
  }
  throw new Error('Unknown model alias in three-channel mode');
}
