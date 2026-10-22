import assert from "node:assert/strict";
import test from "node:test";
import { modelChoices } from "./model-choice";
import type { UsageSnapshot } from "./guardrails";
const usage = {
  aiCreditsAvailable: 19,
  status: "normal",
  supplierSpendMicros: 0,
  supplierSpendLimitMicros: 1_000_000,
} as UsageSnapshot;
test("model confirmation offers affordable bands without upgrading the requested band", () => {
  assert.deepEqual(modelChoices("flagship", usage), ["eco", "standard"]);
  assert.deepEqual(modelChoices("eco", usage), ["eco"]);
});
test("an exhausted task quota permits only Eco and a paused subscription permits no model", () => {
  assert.deepEqual(
    modelChoices("flagship", {
      ...usage,
      aiCreditsAvailable: 100,
      status: "degraded",
    }),
    ["eco"],
  );
  assert.deepEqual(
    modelChoices("flagship", { ...usage, status: "paused" }),
    [],
  );
});
test("confirmation includes the projected model supplier cost in its available choices", () => {
  assert.deepEqual(
    modelChoices("flagship", {
      ...usage,
      aiCreditsAvailable: 100,
      supplierSpendMicros: 995_000,
    }),
    ["eco"],
  );
  assert.deepEqual(
    modelChoices("flagship", {
      ...usage,
      aiCreditsAvailable: 100,
      supplierSpendMicros: 998_000,
    }),
    [],
  );
});
test("model confirmation does not offer a free run when the remaining credits are below Eco cost", () => {
  assert.deepEqual(
    modelChoices("flagship", { ...usage, aiCreditsAvailable: 0.5 }),
    [],
  );
});
