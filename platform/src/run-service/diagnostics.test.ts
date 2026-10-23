import assert from "node:assert/strict";
import test from "node:test";
import { runDiagnostics } from "./diagnostics";
const blocked = {
  type: "action_plan.created",
  payload: {
    actionPlan: {
      blockedByCompliance: true,
      actions: [
        { platform: "x", content: "A".repeat(656), hashtags: ["#".repeat(51)] },
      ],
    },
  },
};
test("historical blocked draft explains its full outbound length and retains the generated content", () => {
  const result = runDiagnostics([blocked]);
  assert.equal(result.failure?.kind, "content_blocked");
  assert.match(result.failure!.issues[0]!, /708.*280/);
  assert.equal(result.drafts[0]!.content.length, 656);
});
test("provider authentication errors are classified without exposing raw credential-bearing messages", () => {
  const result = runDiagnostics([
    {
      type: "ai_run.failed",
      payload: { error: "401 invalid token: Bearer sk-private" },
    },
  ]);
  assert.equal(result.failure?.kind, "provider_auth");
  assert.ok(!JSON.stringify(result).includes("sk-private"));
});
test("latest runtime failure takes precedence over the result of an earlier attempt", () => {
  assert.equal(
    runDiagnostics([
      { type: "ai_run.failed", payload: { error: "Invalid API key" } },
      blocked,
    ]).failure?.kind,
    "provider_auth",
  );
});
test("new compliance details preserve the exact blocker without adding warnings as blockers", () => {
  const result = runDiagnostics([
    {
      type: blocked.type,
      payload: {
        ...blocked.payload,
        compliance: {
          issues: [
            { severity: "blocker", message: "Correct the claim." },
            { severity: "warning", message: "Optional style change." },
          ],
        },
      },
    },
  ]);
  assert.deepEqual(result.failure?.issues, ["Correct the claim."]);
});
test("successful generation without blockers has no fabricated failure", () => {
  assert.equal(
    runDiagnostics([
      {
        type: "action_plan.created",
        payload: { actionPlan: { actions: [], blockedByCompliance: false } },
      },
    ]).failure,
    null,
  );
});
