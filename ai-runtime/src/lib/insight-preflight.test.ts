import test from "node:test";
import assert from "node:assert/strict";
import { fitInsightEvidence, requestInputBound } from "./insight-preflight";
import type { MeterEnvelope } from "../../../shared/ai-metering";
const meta: MeterEnvelope = {
  workspaceId: "w",
  operationId: "o",
  requestId: "r",
  maxCostNanos: "50000000",
  maxInputTokens: 5000,
  maxOutputTokens: 1500,
  rate: {
    version: "test",
    model: "fixture",
    responseModels: ["fixture"],
    inputUsdPerMillion: "2",
    cacheUsdPerMillion: "0.2",
    outputUsdPerMillion: "10",
    source: "test fixture",
    verifiedAt: "2026-11-05T00:00:00Z",
  },
};
test("budget preflight includes instructions and schema, preserves all selected evidence when the full request fits", () => {
  const pack = {
    goal: "Understand refund complaints",
    topItems: Array.from({ length: 40 }, (_, i) => ({
      ref: "e" + i,
      text: "用户评论".repeat(80),
    })),
    priorReports: [{ summary: "Old summary".repeat(200) }],
    tagSamples: [{ text: "duplicate" }],
  };
  const body = {
    messages: [
      { role: "system", content: "Do not invent evidence." },
      {
        role: "user",
        content: "Evidence pack as JSON:\n" + JSON.stringify(pack),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { schema: { description: "schema overhead".repeat(30) } },
    },
  };
  const result = fitInsightEvidence(body, {...meta,maxInputTokens:64000,maxCostNanos:"500000000"});
  assert.equal(result.originalEvidence, 40);
  assert.equal(result.selectedRefs.length,40);
  assert.ok(requestInputBound(body) <= 64000);
  assert.ok(body.messages[1]!.content.includes(pack.goal));
  assert.equal(body.messages[0]!.content, "Do not invent evidence.");
});
test("preflight fails before a provider request when fixed instructions cannot fit", () => {
  const body = {
    messages: [
      { role: "system", content: "large".repeat(10000) },
      {
        role: "user",
        content:
          "Evidence pack as JSON:\n" +
          JSON.stringify({
            goal: "Keep this goal",
            topItems: [{ ref: "e1", text: "one" }],
          }),
      },
    ],
  };
  assert.throws(
    () => fitInsightEvidence(body, meta),
    /ai_input_exceeds_confirmed_limit/,
  );
  assert.ok(body.messages[1]!.content.includes("Keep this goal"));
});
