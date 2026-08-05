export const PLAN_KEYS = ['creator', 'growth', 'agency'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const MODEL_BANDS = ['eco', 'standard', 'flagship'] as const;
export type ModelBand = (typeof MODEL_BANDS)[number];

export interface PlanEntitlement {
  priceCents: number;
  taskQuota: number;
  aiCredits: number;
  supplierSpendLimitCents: number;
}

export const PLAN_CATALOG: Record<PlanKey, PlanEntitlement> = {
  creator: { priceCents: 1_900, taskQuota: 2_000, aiCredits: 400, supplierSpendLimitCents: 600 },
  growth: { priceCents: 5_900, taskQuota: 10_000, aiCredits: 2_500, supplierSpendLimitCents: 2_000 },
  agency: { priceCents: 16_900, taskQuota: 50_000, aiCredits: 8_000, supplierSpendLimitCents: 5_500 },
};

export interface ModelBandPolicy {
  credits: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxTargets: number;
  supplierCostMicros: number;
}

export const MODEL_BAND_POLICIES: Record<ModelBand, ModelBandPolicy> = {
  eco: { credits: 1, maxInputTokens: 8_000, maxOutputTokens: 1_500, maxTargets: 5, supplierCostMicros: 2_000 },
  standard: { credits: 6, maxInputTokens: 16_000, maxOutputTokens: 2_000, maxTargets: 10, supplierCostMicros: 35_000 },
  flagship: { credits: 20, maxInputTokens: 32_000, maxOutputTokens: 4_000, maxTargets: 20, supplierCostMicros: 150_000 },
};

export function planKey(value: string): PlanKey {
  if ((PLAN_KEYS as readonly string[]).includes(value)) return value as PlanKey;
  throw new Error(`Unknown billing plan: ${value}`);
}

export function requestedModelBand(allowedModelClasses: string[]): ModelBand {
  if (allowedModelClasses.includes('flagship')) return 'flagship';
  if (allowedModelClasses.includes('standard')) return 'standard';
  return 'eco';
}
