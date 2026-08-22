import type { AppConfig } from '../config';

export type ModelBand = keyof AppConfig['models'];
export type LlmProvider = 'primary' | 'fallback';

export function modelForBand(
  config: Pick<AppConfig, 'models' | 'fallbackModels'>,
  band: ModelBand,
  provider: LlmProvider,
): string {
  if (provider === 'primary') return config.models[band];

  const fallback = config.fallbackModels[band];
  if (!fallback) {
    throw new Error(
      `Fallback provider selected for ${band}, but AI_MODEL_${band.toUpperCase()}_FALLBACK is not configured`,
    );
  }
  return fallback;
}
