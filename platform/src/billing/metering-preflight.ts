/** Read-only checks: no model calls, Stripe calls, balances or credentials printed. */
import { Pool } from "pg";
import {
  meteringMode,
  ratesFromEnv,
  rateForTime,
} from "../../../shared/ai-metering";
async function main() {
  const mode = meteringMode();
  if (mode !== "legacy") {
    const rates = ratesFromEnv();
    for (const rate of Object.values(rates))
      rateForTime(rate, new Date().toISOString());
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    const r = await pool.query(
      `SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])`,
      [
        [
          "ai_cost_operation",
          "ai_cost_request",
          "ai_cost_receipt",
          "ai_cost_journal",
          "ai_cost_legacy_subject",
        ],
      ],
    );
    if (
      r.rows.length !== 5 ||
      r.rows.some((row) => !row.relrowsecurity || !row.relforcerowsecurity)
    )
      throw new Error("metering_schema_not_ready");
    const response = await fetch(
      new URL(
        "/internal/health",
        process.env.AI_RUNTIME_URL ?? "http://127.0.0.1:4111",
      ),
      { signal: AbortSignal.timeout(10000) },
    );
    const health = (await response.json()) as { meteringProtocol?: string };
    if (!response.ok || health.meteringProtocol !== "cost-v1")
      throw new Error("runtime_metering_version_mismatch");
    console.log(
      JSON.stringify({
        ok: true,
        mode,
        schema: "ready",
        runtime: "cost-v1",
        verifiedRates: mode !== "legacy",
      }),
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "AI metering preflight failed; verify migration, runtime version, mode and verified tariff snapshots.",
  );
  process.exitCode = 1;
});
