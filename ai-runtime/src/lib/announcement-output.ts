import { z } from 'zod';
import { runtimeCostContext } from './cost-metering';
import { markTaskFailure } from './request-trace';

/** Validate the same response once; never repair, retry or publish partial output. */
export function parseAnnouncementOutput<T extends z.ZodTypeAny>(
  schema: T,
  result: { object?: unknown; text?: string; finishReason?: string },
): z.infer<T> {
  const fail = (code: string): never => {
    markTaskFailure(code);
    throw new Error(code);
  };
  if (result.finishReason === 'length') {
    const budget = runtimeCostContext.getStore();
    if (budget?.creditBoundOutput && !budget.shadow) {
      budget.guardError = 'ai_confirmed_budget_exhausted';
      return fail(budget.guardError);
    }
    return fail('pipeline_output_truncated');
  }
  if (['content-filter', 'content_filter'].includes(result.finishReason ?? ''))
    return fail('pipeline_output_filtered');
  if (['error', 'tool-calls', 'tool_calls'].includes(result.finishReason ?? ''))
    return fail('pipeline_output_incomplete');
  let value = result.object;
  if (value === undefined) {
    const text = (result.text ?? '').trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    if (!text) return fail('pipeline_output_empty');
    try { value = JSON.parse(text); } catch { return fail('pipeline_output_invalid_json'); }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail('pipeline_output_invalid_schema');
  return parsed.data;
}
