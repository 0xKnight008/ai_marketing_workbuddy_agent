# Cost-v1 AI credit metering

Approved policy: [Chinese review](AI_CREDIT_PRICING_REVIEW_2026-10-24.md). No redenomination: Creator/Growth/Agency remain $19/$59/$169 with 400/2,500/8,000 monthly credits; topups remain $10/1,000 and trial allowance 30. Referral terms remain unchanged.

For valid saved work, credits = ceil(USD cost × 1.20 / 0.001). Integer nanodollar math avoids floating point boundary errors. Parent operations accumulate cost before rounding, including additional confirmed budget segments for the same business subject. Prior journals stay immutable; only the cumulative credit difference settles. System-fault attempts are operating expense, not user billable cost. Reasoning is already part of output, and cache counts are subsets of input.

## Contract

Authenticated POST `/api/billing/ai-quote`: `{kind,modelBand,maxCredits?}`. Kinds: task.turn, import.classify, insight.generate, topics.cluster, prepare_ai_run. Returns mode, quoteId, estimate, maximum, rate version and ten-minute expiry. The estimate is conservative, not a promised final cost. Imports use a user-adjustable initial budget; very large imports may require another explicit confirmation. Quotes are tenant/actor/kind/band-bound, single-use and stored independently of the user-visible result.

Send `aiQuoteId` with the generation request. The accepted quote binds to the created message/batch/report/topic/run ID. A task creation without generation is not an AI debit. Normal imports create a classification job, which is billable AI processing and therefore requires its own budget confirmation.

The worker locks billing before reserving the confirmed maximum from trial, included, then purchased funds. Internal `/chat/completions` calls carry a private metering envelope, stable request ID and rate snapshot. Runtime stores request claims, output replay and token-only receipts in the existing private LibSQL database. Before contacting a model, a conservative UTF-8 byte upper bound checks input and reduces the output limit to the affordable cap. This can reject long multilingual input conservatively; users can narrow sources, without an unapproved model change. Streaming model requests are rejected in cost-v1 until complete usage can be metered safely.

Platform receives authenticated receipts before interpreting the result. The result transaction marks only validated, saved requests billable; cumulative settlement does not round every internal call separately. Final settlement releases the unused maximum to the original funding buckets. Already valid chunks remain billable after later failure. Publishing failure or rejecting valid text does not refund successful generation.

Unknown tokens/cost remain unknown, not zero. User output may be saved with reconciliation pending. The remainder of the hold is released after 24 hours if no verifiable bill arrives; later unknown bills cannot charge the customer again. Receipt identity conflicts fail closed. Provider-failure cost is retained and monitored against a separate failure reserve/circuit; refunds cannot erase supplier expense. Budget-exhausted jobs wait for an explicit new quote. Legacy in-flight subjects keep their existing fixed policy.

## Storage and access

Migration 0040 adds tenant-RLS operation, request, receipt, journal and legacy-subject tables. It does not alter 0039 or rewrite old task_event entries. New debits/releases live in an append-only journal; policy version identifies the billing basis. Legacy and cost-v1 data both contribute to balance calculations. A quote accepted before any hold cannot generate a refund. Concurrent settlement takes the billing lock first.

The runtime and platform are separate databases. Durable cached responses/receipts and signed callbacks or authenticated polling provide replay/recovery; this is not a distributed transaction. Runtime response caching contains private generated output under the same storage boundary as the run registry; raw prompts/keys are not stored in cost receipts. A failed or ambiguous request is not automatically sent again as a potentially new paid attempt. User-requested retry requires a new approved quote after reconciliation/release.

Customer Plan & usage and result receipts show maximum, outstanding hold, settled credits, releases, state, and actual model. Admin retains Token usage and its existing CSV; a separate Chinese/English cost reconciliation panel accepts a workspace UUID and exports the latest 100 operations explicitly, with formula-safe CSV. Cost nanounits are USD, not tokens or credits. No UI edits supplier prices or displays keys.

## Supplier budgets

Verified rates are configured in Platform as JSON, versioned and captured in each quote. Convert supplier currency to USD using a recorded FX snapshot before configuring; this implementation does not fetch exchange rates or infer invoice prices from a model catalogue. Use conservative peak rates for preflight and explicit UTC tariff periods plus calendar expiry for actual settlement; peak rates must not be indiscriminately charged off-peak. Do not enable a band until its effective tariff is verified. Topups increase executable AI funding. Cost-v1 separates channel/external-action spend from AI metering: the external $6/$20/$55 limits stay fixed and cannot grow with supplier spend or AI topups. Their state is exposed as externalActionStatus in Plan & usage; projected external actions still stop at their limits while funded AI work retains its own credit checks.

Zernio internal account budget is $1/month. At 100+ full-month accounts aggregated under the one platform team, the published graduated invoice is account count + $218; that fixed difference is a company expense, not charged per workspace. Connection changes should be reconciled to provider account-days; the internal current-account budget is not an exact daily-prorated supplier invoice. X and other externally metered APIs remain subject to their own fees/authorization.

Follow [rollout](AI_CREDIT_METERING_ROLLOUT.md); default legacy mode does not activate financial changes on deployment.
