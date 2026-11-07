import {
  usageCostNanos,
  inputBudgetRate,
  type MeterEnvelope,
} from "../../../shared/ai-metering";
export type InputCoverage = {
  inputUpperBound: number;
  originalEvidence: number;
  selectedRefs: string[];
  sampling: "representative";
  estimator: "utf8-upper-bound";
};
/** Count the complete serialized provider request conservatively. This is an upper
 * bound, NOT a tokenizer result. Include instructions, schema/tools and history.
 * Reject before provider execution; never silently shrink the approved evidence. */
export function requestInputBound(body: Record<string, any>): number {
  return (
    Buffer.byteLength(
      JSON.stringify({
        messages: body.messages,
        tools: body.tools,
        response_format: body.response_format,
      }),
      "utf8",
    ) +
    64 * (body.messages?.length ?? 1)
  );
}
export function fitInsightEvidence(
  body: Record<string, any>,
  meta: MeterEnvelope,
): InputCoverage {
  const marker = "Evidence pack as JSON:\n";
  let write: ((s: string) => void) | undefined,
    raw = "";
  for (const message of body.messages ?? []) {
    if (
      typeof message.content === "string" &&
      message.content.includes(marker)
    ) {
      raw = message.content;
      write = (s) => (message.content = s);
      break;
    }
    if (Array.isArray(message.content)) {
      for (const c of message.content) {
        if (
          c.type === "text" &&
          typeof c.text === "string" &&
          c.text.includes(marker)
        ) {
          raw = c.text;
          write = (s) => (c.text = s);
          break;
        }
      }
    }
    if (write) break;
  }
  if (!write) throw new Error("insight_preflight_format_invalid");
  const index = raw.indexOf(marker) + marker.length;
  const pack = JSON.parse(raw.slice(index));
  const original = Array.isArray(pack.topItems) ? pack.topItems.length : 0;
  const fits = () =>
    requestInputBound(body) <= meta.maxInputTokens &&
    usageCostNanos(inputBudgetRate(meta.rate), {
      input: requestInputBound(body),
      output: Math.min(meta.maxOutputTokens, 1500),
      cached: 0,
    }) <= BigInt(meta.maxCostNanos);
  if (!fits()) throw new Error("ai_input_exceeds_confirmed_limit");
  return {
    inputUpperBound: requestInputBound(body),
    originalEvidence: original,
    selectedRefs: pack.topItems.map((i: { ref: string }) => i.ref),
    sampling: "representative",
    estimator: "utf8-upper-bound",
  };
}
