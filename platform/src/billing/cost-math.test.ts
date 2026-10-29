import assert from "node:assert/strict";
import test from "node:test";
import {
  costCredits,
  cacheWriteUsage,
  inputBudgetRate,
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

test('cache-write TTL rates replace ordinary input cost and are never double counted',()=>{
 const opus={...rate,inputUsdPerMillion:'4',outputUsdPerMillion:'20',cacheUsdPerMillion:'0.2',cacheWrite5mUsdPerMillion:'5',cacheWrite1hUsdPerMillion:'8'};
 assert.equal(usageCostNanos(opus,{input:1000,output:100,cached:200,cacheWrite5m:300,cacheWrite1h:100}),5940000n);
 assert.throws(()=>usageCostNanos(opus,{input:100,output:1,cached:50,cacheWrite5m:60}));
 assert.throws(()=>usageCostNanos(rate,{input:100,output:1,cached:0,cacheWrite1h:1}),/unverified_cache_write_rate/);
 assert.throws(()=>validateRate({...opus,cacheWrite1hUsdPerMillion:'-1'}));
});


test('cache write aliases require consistent counts and explicit TTL, and reservations cover the higher TTL',()=>{
 assert.deepEqual(cacheWriteUsage({prompt_tokens_details:{cache_write_tokens:10,cache_creation_tokens:10,cache_creation_token_details:{ephemeral_5m_input_tokens:6,ephemeral_1h_input_tokens:4}},cache_creation_input_tokens:10}),{cacheWrite5m:6,cacheWrite1h:4});
 assert.equal(cacheWriteUsage({prompt_tokens_details:{cache_creation_tokens:10}}),null);
 assert.equal(cacheWriteUsage({prompt_tokens_details:{cache_creation_tokens:10,cache_write_tokens:9}}),null);
 assert.equal(cacheWriteUsage({cache_creation_input_tokens:10,cache_creation:{ephemeral_5m_input_tokens:9}}),null);
 assert.equal(inputBudgetRate({...rate,cacheWrite5mUsdPerMillion:'5',cacheWrite1hUsdPerMillion:'8'}).inputUsdPerMillion,'8');
});
