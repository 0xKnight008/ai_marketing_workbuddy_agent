# AI cost metering rollout and rollback

## Safety boundary

Ordinary deployment installs migration 0040 and the code, but the default `AI_METERING_MODE=legacy` preserves existing charges. No Stripe Price, topup rate, customer balance denomination, referral reward, provider key or upstream model is changed. Do not run paid smoke requests automatically. Preserve Eco/Standard direct keys and the existing LiteLLM virtual key. Server-owned LiteLLM config copies must retain the narrowly scoped temperature/strictJsonSchema filter from the repository.

## Configure verified rates

Set `AI_METERING_MODE` and `AI_METERING_RATES_JSON` in `/etc/piggybot/platform.env` for gateway AND worker. Runtime receives the versioned snapshot through the existing authenticated private API; never place supplier keys in this JSON. The JSON has eco, standard and flagship objects:

```json
{"eco":{"version":"REPLACE_VERIFIED_VERSION","model":"REPLACE_WIRE_ALIAS","responseModels":["REPLACE_ACTUAL_MODEL"],"inputUsdPerMillion":"REPLACE","outputUsdPerMillion":"REPLACE","cacheUsdPerMillion":"REPLACE","source":"REPLACE_CONTRACT_OR_OFFICIAL_RATE_REFERENCE","verifiedAt":"REPLACE_ISO_DATE","currency":"REPLACE_ORIGINAL_CURRENCY","fxSnapshot":"REPLACE_RECORDED_USD_CONVERSION"}}
```

This deliberately incomplete example fails validation. Add the standard/flagship entries only with verified prices; no invented production tariff is shipped. Flagship wire alias is `primary-flagship`; responseModels must list the exact models/aliases authorized by the current supplier contract. In `three-channel` mode, DeepSeek/Z.AI wire models use their configured direct-channel names. For staged `litellm` routing, use the candidate generator in [UNIFIED_LITELLM_MIGRATION.md](UNIFIED_LITELLM_MIGRATION.md) to update proxy wire aliases and accepted response models while preserving the complete rate calendar. Rate values are decimal strings in USD per million tokens, already converted at the recorded currency rate. Cache rate may equal normal input if that supplier does not price cache reads differently. Version snapshots must change when rates/FX/model identities change.

For tariffs varying by time or context, activate only after the configured profile represents the charged tariff. For variable tariffs, configure a base tariff plus non-overlapping absolute UTC `periods` with `id`, `startsAt`, `endsAt` and the three USD rate fields, and a `validUntil` for the calendar. Populate official peak windows excluding holidays. Quotes use the maximum rate; receipts settle at their recorded request time. Expired calendars stop before the provider call. Do not charge all off-peak usage at a peak rate.

## Acceptance sequence

1. Back up PostgreSQL and private LibSQL; deploy platform, workers and runtime together. Apply 0040 once using the normal migration runner, never edit already-deployed migrations. Check forced RLS on all five new tables.
2. Leave legacy mode while validating the JSON in a protected shell. Public pages describe the policy shown at submission, so an unactivated environment does not promise cost-v1 settlement. Do not change the existing Stripe subscription Prices.
Run `npm run metering:check` from `platform/` with the same protected environment as the gateway before each switch. This only checks verified rate validity, forced RLS and the runtime protocol; it does not call a paid model or print secrets.

3. Set mode to `shadow`, restart gateway/worker to load environment, and run controlled user-authorized small operations. Customer credits still use the legacy policy. Verify receipt identity, models, tokens, rate snapshots and comparison with the actual supplier invoice. All three channels need validation; a provider catalogue spend figure alone is insufficient.
4. Ensure quoting, result receipts, refund and unknown-usage paths pass in the target environment. Inspect any failure-circuit events. Check imports, reports, task conversation, topics and publishing, including explicit budget confirmation for scheduled work without standing authorization. Do not blanket-wake queued jobs awaiting confirmation.
5. Drain in-flight work and snapshot billing. Set mode to `cost-v1`, restart gateway/worker, and confirm one small operation per band through the app. Rate or quote failures must stop before the supplier call. User-triggered paid acceptance is separate from local stubbed tests.
6. Compare balance movements, returned holds, shadow-vs-live records and provider invoices. Unknown usage is pending reconciliation, not free. Verify that a failed initial request returns its entire hold, and a partial-result failure preserves only its effective settled cost.

Quotes expire after ten minutes before acceptance. Accepted operations retain their rate/policy snapshot. Quotes in shadow mode do not become cost-v1 invoices merely because an environment switch changed. Missing prior authorization in cost-v1 pauses a job for budget confirmation instead of silently using a default paid cap.

## Rollback

Stop accepting new cost-v1 operations, drain active work and reconcile outstanding holds, then restore legacy mode. Do not revert 0040, truncate the journal, recompute historical costs or erase provider receipts. Existing accepted operations retain their policy and must be completed/released with this build before reverting binaries. The pre-migration and legacy-mode subject directory protects old in-flight billing without reinterpreting its 1/6/20 records.

## Financial acceptance

Subscription prices remain $19/$59/$169, allowances 400/2,500/8,000; one-time $10 buys 1,000 credits and trial is 30. Supplier loss, payment fees, Zernio's global tier premium, staff costs and referral invoice credits remain separate from the customer AI-credit journal. The $200k–$250k MRR operating target is conditional on customer mix, verified tariffs, budget compliance and blended referral expense; deployment is not a guarantee of 60% operating margin.
