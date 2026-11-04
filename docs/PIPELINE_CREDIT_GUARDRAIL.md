# Pipeline output budget and generation diagnostics

## Production incident, 2026-11-04

Run `6d1e5999-09e9-41bb-9b33-f72bf46ee82a` reached content planning successfully, then failed during copy optimization. Both upstream requests returned HTTP 200. The second response had `finish_reason: length`, zero final-content characters, and reasoning content. The old Eco cap was 1,500 output tokens, including reasoning; parsing an absent structured object masked the actual cause as Zod `Required`. The production cost operation was verified as `refunded`, with zero held and zero settled credits. No approval or publication was created.

## Approved policy

Do not replace the old limit with a new fixed 8,192-token cap. For **all three Pipeline model tiers in cost-v1**, derive each model call's output allowance from the remaining user-confirmed credit budget:

1. Convert confirmed maximum credits to the existing versioned upstream cost ceiling (current pricing: `ceil(C × 1.06 / 0.01)`).
2. Reserve the remaining operation cost for the three-step announcement workflow.
3. Before each call, subtract actual prior model costs, conservatively reserved unknown usage, and the current input-cost upper bound.
4. Divide the remaining cost by the configured output-token rate, rounding down. Send that budget-derived value as `max_tokens`.

The old tier output quantities remain **quote estimation references** for Pipelines, not execution limits. SDK defaults also cannot reintroduce the old cap. Non-Pipeline operations, legacy/shadow behavior, tariffs and subscription prices are unchanged. No database migration is needed. Input/context limits and upstream model/API limits still apply; this is not an unlimited model context or unlimited spend promise.

The user may change maximum credits before confirming. An increase never silently draws more credits than the accepted budget. Actual valid results retain the existing settlement formula; unused reservations are released. Unknown provider usage remains conservatively reserved.

## Budget exhaustion and publication safety

A credit-bounded output ending with `length` is a budget-stop event, not a reviewable draft. The existing model-choice/quote workflow pauses the job until explicit user confirmation. It restarts generation with a newly accepted budget; it does not continue a half-written model response or publish it. There is no hidden paid repair retry or automatic model switch.

JSON/schema validation, exact destination matching, platform length checks, forbidden-word checks and human publication approval remain mandatory. Empty or malformed outputs cannot create an approval. The generic aggregate draft token cap is removed only for credit-bounded Pipeline generation; individual publishing-platform limits remain enforced.

The UI explains budget exhaustion in English, Chinese and Spanish. Traces now include the platform run ID, model tier and final safe failure code. A newly started attempt clears the previous attempt's budget failure from diagnostics.

## Deployment and acceptance

Deploy platform and AI runtime together using the normal release workflow, then restart both services. There is no LiteLLM configuration change or new environment variable required. Existing failed runs are not automatically rerun. Start a new Pipeline and explicitly confirm its maximum credits.

Validate: three model steps reach inline review; nothing publishes before approval; a deliberately low budget produces a confirmation request without an automatic retry; raising the budget requires consent; publishing remains idempotent. Use test accounts for real publishing.

Tests use synthetic responses and disposable databases: real Mastra workflow execution, per-tier runtime budget accounting, PostgreSQL billing/approval/consent behavior, and en/zh/es browser diagnostics. These do not incur upstream charges or publish posts.

Reference: [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/) describes reasoning before final output and API controls. Production request traces, rather than an assumed provider default, established this incident's failure mode.
