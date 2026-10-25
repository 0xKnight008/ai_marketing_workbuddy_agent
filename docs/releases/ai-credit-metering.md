# Cost-v1 implementation — 2026-10-25

Implements the approved first version of [the review](../AI_CREDIT_PRICING_REVIEW_2026-10-24.md). Prices remain $19/$59/$169, monthly credits 400/2,500/8,000, trial 30 and topups $10/1,000. Referral terms and existing Stripe Prices are unchanged.

The new policy quotes a confirmed maximum, reserves its original funding sources, meters actual provider usage with verified rate snapshots, settles valid saved work cumulatively and releases the difference. Same-subject budget reconfirmation does not create another minimum credit. Unknown usage holds remain reconcilable for 24 hours; unverifiable costs cannot become an invented customer debit. AI funding is separate from fixed external-action budgets. Provider fault costs remain visible and subject to a loss circuit.

Tasks, imports, reports, topics and publishing use the same metering contract. Result settlement/release occurs inside the lease-fenced save transaction. Async workflow budget exhaustion queues explicit confirmation, while stale callbacks cannot modify a superseding budget. Runtime claims and private cached responses prevent repeated paid requests after transport replay.

Customer budget/receipt UI and public pricing, terms and all nine audience pages support en/zh/es; admin cost records support en/zh and retain token usage and its existing CSV. Public prices, SEO metadata, canonical links, structured data and audience CTAs are preserved.

Migration 0040 is additive and forces tenant RLS on five new tables. Runtime also creates two private receipt/replay tables in its existing LibSQL storage. Historical credits, reservations and refunds are not redenominated or recomputed. The server artifact includes the shared math module and operational documentation.

## Rollout boundary

Deployment defaults to legacy billing. Configure verified rates for all three routes, check `npm run metering:check`, compare shadow receipts with supplier invoices, then explicitly activate cost-v1. Eco and Standard stay direct; Flagship stays on LiteLLM. Do not activate guessed Standard/Flagship tariffs or treat mocked tests as live supplier acceptance. See [rollout and rollback](../AI_CREDIT_METERING_ROLLOUT.md).

## Local validation

PostgreSQL tests cover migration, RLS, concurrent holds, original-source and prior-period refunds, partial outputs, unknown usage, trial payment recovery, budget continuations and the real task-service/worker receipt path. Platform/runtime typechecks, frontend/runtime builds and a compiled-runtime local-model smoke check are included. Chromium budget/public/admin tests cover all three customer locales and both admin locales, CSV, cancellation and the extra trial billing notice. A broader Firefox/Chromium attempt encountered browser startup/timeouts locally; it is not reported as a passing cross-browser run. No production model request, Stripe payment or deployment was performed.
