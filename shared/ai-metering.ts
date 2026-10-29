/** Versioned cost math shared by execution and billing. No SDK/catalogue prices. */
export type Band = "eco" | "standard" | "flagship";
export const COST_VERSION = "cost-v1";
export interface Rate {
  version: string;
  model: string;
  responseModels: string[];
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  cacheUsdPerMillion: string;
  cacheWrite5mUsdPerMillion?: string;
  cacheWrite1hUsdPerMillion?: string;
  source: string;
  verifiedAt: string;
  currency?: string;
  fxSnapshot?: string;
  validUntil?: string;
  periods?: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    inputUsdPerMillion: string;
    outputUsdPerMillion: string;
    cacheUsdPerMillion: string;
  }>;
}
export interface Usage {
  input: number;
  output: number;
  cached: number;
  reasoning?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
}
export interface MeterEnvelope {
  workspaceId: string;
  operationId: string;
  requestId: string;
  rate: Rate;
  shadow?: boolean;
  band?: Band;
  guardError?: string;
  maxCostNanos: string;
  maxInputTokens: number;
  maxOutputTokens: number;
}
export interface Receipt extends Usage {
  id: string;
  requestId: string;
  operationId: string;
  workspaceId: string;
  model: string;
  startedAt?: string;
  costNanos: string | null;
  status: "known" | "unknown";
}
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function decimalNanos(value: string): bigint {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value))
    throw new Error("invalid_decimal_rate");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1000000000n + BigInt(fraction.padEnd(9, "0"));
}
export function validateRate(value: unknown): Rate {
  const r = value as Rate;
  if (
    !r ||
    !/^[a-zA-Z0-9_.-]{1,80}$/.test(r.version) ||
    !r.model ||
    r.model.length > 150 ||
    !Array.isArray(r.responseModels) ||
    !r.responseModels.length ||
    r.responseModels.some((m) => typeof m !== "string" || m.length > 150) ||
    !r.source ||
    r.source.length > 500 ||
    !Number.isFinite(Date.parse(r.verifiedAt))
  )
    throw new Error("unverified_ai_rate");
  const input = decimalNanos(r.inputUsdPerMillion),
    output = decimalNanos(r.outputUsdPerMillion),
    cached = decimalNanos(r.cacheUsdPerMillion);
  if (input <= 0n || output <= 0n || cached > input)
    throw new Error("invalid_ai_rate");
  for (const value of [r.cacheWrite5mUsdPerMillion, r.cacheWrite1hUsdPerMillion]) {
    if (value !== undefined && decimalNanos(value) <= 0n) throw new Error("invalid_cache_write_rate");
  }
  if (r.validUntil !== undefined && !Number.isFinite(Date.parse(r.validUntil)))
    throw new Error("invalid_rate_expiry");
  if (r.periods) {
    if (!Array.isArray(r.periods) || r.periods.length > 1000 || !r.validUntil)
      throw new Error("invalid_tariff_calendar");
    const periods = [...r.periods].sort(
      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
    );
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i]!;
      if (
        !p.id ||
        !Number.isFinite(Date.parse(p.startsAt)) ||
        !Number.isFinite(Date.parse(p.endsAt)) ||
        Date.parse(p.endsAt) <= Date.parse(p.startsAt) ||
        (i > 0 && Date.parse(periods[i - 1]!.endsAt) > Date.parse(p.startsAt))
      )
        throw new Error("invalid_tariff_calendar");
      validateRate({ ...r, ...p, periods: undefined });
    }
  }
  return r;
}
export function rateForTime(rate: Rate, at: string): Rate {
  const time = Date.parse(at);
  if (
    !Number.isFinite(time) ||
    (rate.validUntil && time >= Date.parse(rate.validUntil))
  )
    throw new Error("ai_rate_snapshot_expired");
  const p = rate.periods?.find(
    (p) => time >= Date.parse(p.startsAt) && time < Date.parse(p.endsAt),
  );
  return p
    ? { ...rate, ...p, version: rate.version + ":" + p.id, periods: undefined }
    : { ...rate, periods: undefined };
}
function ceilingRate(rate: Rate): Rate {
  const values = [rate, ...(rate.periods ?? [])];
  const maximum = (
    key: "inputUsdPerMillion" | "outputUsdPerMillion" | "cacheUsdPerMillion",
  ) =>
    values.reduce(
      (a, r) => (decimalNanos(r[key]) > decimalNanos(a) ? r[key] : a),
      "0",
    );
  return {
    ...rate,
    inputUsdPerMillion: maximum("inputUsdPerMillion"),
    outputUsdPerMillion: maximum("outputUsdPerMillion"),
    cacheUsdPerMillion: maximum("cacheUsdPerMillion"),
    periods: undefined,
  };
}
export function usageCostNanos(rate: Rate, usage: Usage, at?: string): bigint {
  rate = at ? rateForTime(rate, at) : ceilingRate(rate);
  const write5m = usage.cacheWrite5m ?? 0, write1h = usage.cacheWrite1h ?? 0;
  if (
    ![usage.input, usage.output, usage.cached, write5m, write1h].every(integer) ||
    usage.cached + write5m + write1h > usage.input
  )
    throw new Error("invalid_token_usage");
  if ((write5m && !rate.cacheWrite5mUsdPerMillion) || (write1h && !rate.cacheWrite1hUsdPerMillion)) throw new Error("unverified_cache_write_rate");
  // reasoning is a subset of output; never add it again.
  const numerator =
    BigInt(usage.input - usage.cached - write5m - write1h) * decimalNanos(rate.inputUsdPerMillion) +
    BigInt(usage.cached) * decimalNanos(rate.cacheUsdPerMillion) +
    BigInt(usage.output) * decimalNanos(rate.outputUsdPerMillion) +
    BigInt(write5m) * decimalNanos(rate.cacheWrite5mUsdPerMillion ?? "0") +
    BigInt(write1h) * decimalNanos(rate.cacheWrite1hUsdPerMillion ?? "0");
  return (numerator + 999999n) / 1000000n;
}
export function costCredits(nanos: bigint): number {
  if (nanos < 0n) throw new Error("invalid_ai_cost");
  const credits = (nanos * 6n + 4999999n) / 5000000n;
  if (credits > 100000000n) throw new Error("ai_cost_out_of_range");
  return Number(credits);
}
export function creditCostCeiling(credits: number): bigint {
  if (!integer(credits)) throw new Error("invalid_credit_budget");
  return (BigInt(credits) * 5000000n) / 6n;
}
export function ratesFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<Band, Rate> {
  let parsed: Record<Band, Rate>;
  try {
    parsed = JSON.parse(env.AI_METERING_RATES_JSON ?? "");
  } catch {
    throw new Error("configure_verified_ai_rates");
  }
  for (const band of ["eco", "standard", "flagship"] as const)
    validateRate(parsed?.[band]);
  return parsed;
}
export function meteringMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): "legacy" | "shadow" | "cost-v1" {
  const mode = env.AI_METERING_MODE ?? "legacy";
  if (mode !== "legacy" && mode !== "shadow" && mode !== "cost-v1")
    throw new Error("invalid_ai_metering_mode");
  return mode;
}

/** Conservative reservation: all input could be written at the highest verified TTL rate. */
export function inputBudgetRate(rate: Rate): Rate {
  const maximum = [rate.inputUsdPerMillion, rate.cacheWrite5mUsdPerMillion, rate.cacheWrite1hUsdPerMillion]
    .filter((v): v is string => v !== undefined).reduce((a,b) => decimalNanos(a) >= decimalNanos(b) ? a : b);
  return {...rate,inputUsdPerMillion:maximum};
}
/** OpenAI-compatible usage includes cache reads/writes in total prompt_tokens. */
export function cacheWriteUsage(usage: any): {cacheWrite5m: number; cacheWrite1h: number} | null {
  const details = usage.prompt_tokens_details ?? {};
  const split = details.cache_creation_token_details ?? usage.cache_creation;
  const totals = [details.cache_write_tokens, details.cache_creation_tokens, usage.cache_creation_input_tokens].filter(v => v !== undefined && v !== null);
  if (totals.some(v => !integer(v)) || totals.some(v => v !== totals[0])) return null;
  if (!split) return totals.some(v => v > 0) ? null : {cacheWrite5m:0,cacheWrite1h:0};
  const cacheWrite5m = split.ephemeral_5m_input_tokens ?? 0, cacheWrite1h = split.ephemeral_1h_input_tokens ?? 0;
  if (![cacheWrite5m,cacheWrite1h].every(integer) || totals.some(v => v !== cacheWrite5m + cacheWrite1h)) return null;
  return {cacheWrite5m,cacheWrite1h};
}
