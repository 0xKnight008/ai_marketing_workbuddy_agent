import assert from "node:assert/strict";
import test from "node:test";
import {
  costCredits,
  creditCostCeiling,
  usageCostNanos,
  validateRate,
  ratesFromEnv,
} from "../../../shared/ai-metering";
const rate = {
  version: "fixture-v1",
  model: "fixture-model",
  responseModels: ["fixture-model"],
  inputUsdPerMillion: "2",
  outputUsdPerMillion: "10",
  cacheUsdPerMillion: "0.2",
  source: "test fixture only",
  verifiedAt: "2026-10-24T00:00:00Z",
};
test("uses exact fixed-point cost math, a 20 percent coefficient and one cumulative ceiling", () => {
  assert.equal(costCredits(10798500n), 13);
  assert.equal(costCredits(6696000n), 9);
  assert.equal(costCredits(9788500n), 12);
  assert.equal(costCredits(27283000n), 33);
  assert.equal(costCredits(0n), 0);
  assert.equal(costCredits(1n), 1);
  assert.equal(costCredits(5000000n), 6);
  assert.equal(costCredits(5000001n), 7);
  assert.equal(creditCostCeiling(33), 27500000n);
  assert.ok(costCredits(100000n) + costCredits(100000n) > costCredits(200000n));
});
test("cache and reasoning are subsets, not additional input/output billing", () => {
  assert.equal(
    usageCostNanos(rate, {
      input: 1000,
      output: 800,
      cached: 0,
      reasoning: 600,
    }),
    10000000n,
  );
  assert.equal(
    usageCostNanos(rate, {
      input: 1000,
      output: 800,
      cached: 500,
      reasoning: 600,
    }),
    9100000n,
  );
  assert.throws(() => usageCostNanos(rate, { input: 1, output: 2, cached: 3 }));
  assert.throws(() =>
    usageCostNanos(rate, { input: NaN, output: 2, cached: 0 }),
  );
});
test("requires explicit verified supplier rates rather than assuming a model catalogue", () => {
  assert.throws(() => ratesFromEnv({}), /configure_verified_ai_rates/);
  assert.throws(() => validateRate({ ...rate, outputUsdPerMillion: "0" }));
  assert.throws(() => validateRate({ ...rate, inputUsdPerMillion: "1e-3" }));
  assert.deepEqual(
    ratesFromEnv({
      AI_METERING_RATES_JSON: JSON.stringify({
        eco: rate,
        standard: rate,
        flagship: rate,
      }),
    }).flagship,
    rate,
  );
});

test("quotes the highest scheduled tariff but settles at the recorded request tariff", () => {
  const scheduled = {
    ...rate,
    validUntil: "2027-01-01T00:00:00Z",
    periods: [
      {
        id: "peak",
        startsAt: "2026-10-26T01:00:00Z",
        endsAt: "2026-10-26T04:00:00Z",
        inputUsdPerMillion: "4",
        outputUsdPerMillion: "20",
        cacheUsdPerMillion: "0.4",
      },
    ],
  };
  assert.equal(
    usageCostNanos(scheduled, { input: 1000, output: 800, cached: 0 }),
    20000000n,
  );
  assert.equal(
    usageCostNanos(
      scheduled,
      { input: 1000, output: 800, cached: 0 },
      "2026-10-26T02:00:00Z",
    ),
    20000000n,
  );
  assert.equal(
    usageCostNanos(
      scheduled,
      { input: 1000, output: 800, cached: 0 },
      "2026-10-26T05:00:00Z",
    ),
    10000000n,
  );
  assert.throws(
    () =>
      usageCostNanos(
        scheduled,
        { input: 1, output: 1, cached: 0 },
        "2027-01-01T00:00:00Z",
      ),
    /expired/,
  );
  assert.throws(
    () =>
      validateRate({
        ...scheduled,
        periods: [...scheduled.periods, ...scheduled.periods],
      }),
    /calendar/,
  );
});
