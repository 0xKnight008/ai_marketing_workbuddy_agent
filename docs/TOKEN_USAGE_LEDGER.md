> Cost-v1 update (2026-10-24): see [metering policy](AI_CREDIT_METERING.md) and [rollout](AI_CREDIT_METERING_ROLLOUT.md). Historical fixed-credit/automatic-downgrade descriptions below do not override the policy shown for a new operation. Prices, credit denominations and referral terms do not change.

# Actual token usage ledger

The seven runtime agent factories record every completed model step in LibSQL
`ai_token_usage`, using the runtime's existing `MASTRA_STORAGE_URL` and token.
This covers classification, topics, six insight templates, planning, copy and
compliance across DeepSeek, Z.AI and the configured Flagship proxy. Official
traffic need not pass through one-api. No oneapi.db edits or PostgreSQL migration
are needed. The table is created idempotently on first use; back up LibSQL.

`prompt_tokens` and `completion_tokens` are provider/SDK input and output counts.
`model_name` uses the response model, falling back to the resolved requested model.
`requested_model` retains the logical alias (including Eco fallback). `run_id` is
the Mastra generation ID, not a platform workspace ID. Each step has its own event
ID; genuine retries consume tokens and get separate records. Reasoning and cache
counts are nullable subsets and must not be added again to input/output totals.
Missing counts stay NULL, not zero. No prompts, generated text, credentials or
raw provider metadata are stored. Existing fixed credits/cost guardrails do not change.

The ledger records completed SDK steps even if later structured validation fails.
Provider failures before a usage-bearing step and process death before persistence
cannot supply reliable usage; do not infer zero spend from absent records. This is
not a provider-invoice reconciliation system. Historical traffic is not backfilled.
Storage errors are propagated by the callback rather than intentionally ignored.
The table has no automatic TTL; its retention is independent of the run registry.

## Deployment and access

Deploy runtime and platform together. The platform/gateway needs `AI_RUNTIME_URL`
and `INTERNAL_SERVICE_TOKEN` (the same credential as runtime `INTERNAL_API_TOKEN`).
The runtime endpoint `/internal/token-usage` requires internal authentication;
keep port 4111 private. `/api/admin/token-usage` uses existing admin authentication
and `Cache-Control: no-store`. An ordinary workspace owner is not sufficient.

Admin dashboard → Token usage → Load. Filter by model, provider or generation run
ID. Next-page queries use descending immutable IDs rather than shifting offsets.
Download matching CSV traverses all matching pages, not just the displayed page.
Calls arriving after the first exported page are excluded by cursor progression.
Export is bounded at 100,000 rows with an explicit error instead of a truncated
download. Cells are quoted and formula prefixes neutralized. NULL exports blank.

Read-only SQL example:

```sql
SELECT provider, model_name, COUNT(*) AS model_steps,
       SUM(prompt_tokens) AS prompt_tokens,
       SUM(completion_tokens) AS completion_tokens,
       SUM(CASE WHEN prompt_tokens IS NULL OR completion_tokens IS NULL THEN 1 ELSE 0 END) AS unknown_steps
FROM ai_token_usage
GROUP BY provider, model_name;
```

Verify each configured channel with a controlled call after deployment and inspect
the ledger. Synthetic transport tests do not verify real provider credentials.
