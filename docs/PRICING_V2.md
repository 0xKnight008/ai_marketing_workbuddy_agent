> Cost-v1 update (2026-10-24): see [metering policy](AI_CREDIT_METERING.md) and [rollout](AI_CREDIT_METERING_ROLLOUT.md). Historical fixed-credit/automatic-downgrade descriptions below do not override the policy shown for a new operation. Prices, credit denominations and referral terms do not change.

# Pricing v2 and cost guardrails

## Customer-facing plans

| Plan | Price | Connected accounts | Monthly tasks | Included AI credits | Monthly supplier-spend limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Creator | $19 | 2 | 2,000 | 400 | $6 |
| Growth | $59 | 10 | 10,000 | 2,500 | $20 |
| Agency | $169 | 30 | 50,000 | 8,000 | $55 |

The public trial is up to 7 days or 30 AI credits. Inactive accounts cannot run paid work. A subscribed trial hands off only after successful payment; remaining trial funds are used before paid included and purchased funds. AI topups remain $10 per 1,000 credits. No balance denomination conversion occurs.

## AI routing and cost-v1

| Band | Input cap | Output cap | Target cap | Route |
| --- | ---: | ---: | ---: | --- |
| Eco | 8K tokens | 1.5K tokens | 5 | DeepSeek direct |
| Standard | 16K tokens | 2K tokens | 10 | Z.AI direct |
| Flagship | 32K tokens | 4K tokens | 20 | LiteLLM |

Cost-v1 replaces fixed 1/6/20 internal-step prices with `ceil(valid saved operation cost USD × 1.20 / 0.001)`. Child calls accumulate before rounding. Operators must verify versioned input/output/cache prices and tariff conditions; customer estimates are conservative caps, not supplier invoice evidence. See [metering](AI_CREDIT_METERING.md) for the complete contract.

Before execution the user confirms a maximum, which is reserved atomically. Only valid saved results settle; unused funds return to their original sources. Partial saved work can remain billable after a later failure. Missing usage is pending reconciliation for at most 24 hours, never treated as zero or replaced by an invented fixed charge. Budget/model changes need explicit confirmation. No automatic downgrade or zero-balance free AI run is offered.

## Cost guardrails

Task quotas and external paid actions retain their restrictions. Account budgeting uses $1 per connected account per month internally; Zernio's graduated platform-team invoice and account-days require separate reconciliation. Above 100 full-month accounts under one platform team, the published tier premium is $218/month above that marginal budget. Extra X and other metered APIs remain separate.

In cost-v1, funded AI credits (including topups) govern executable AI budgets instead of blocking purchased credits behind the legacy $6/$20/$55 estimates. Provider-failure expense is retained separately with a failure circuit. Approvals, Stripe access restrictions and external-action quotas remain enforced.

Usage exposes available, reserved and settled amounts; operation receipts and the append-only cost journal preserve policy versions and original funding periods. Admin token usage/CSV is retained alongside cost reconciliation. Legacy charges remain historical; no deployed ledger is rewritten.

## Operations

Apply additive migration 0040 together with current platform/runtime builds. Deployment defaults to legacy; use verified rates, shadow comparison and controlled activation in [rollout](AI_CREDIT_METERING_ROLLOUT.md). The plan table's supplier limits describe legacy operations, not a new cost-v1 customer entitlement. Existing subscription Price IDs and referral terms remain unchanged.

## Stripe account activation

The public pricing buttons lead to `/activate?plan=creator|growth|agency`. The checkout page uses an existing short-lived **workspace owner** token to establish which workspace will be upgraded; it keeps a manually pasted token only in browser memory and sends it to the gateway over HTTPS to create a Checkout Session.

Configure these gateway environment variables with recurring Stripe Price IDs for the three plans:

- `PUBLIC_SITE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_CREATOR`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_AGENCY`
- Yearly: `STRIPE_PRICE_CREATOR_YEARLY`, `STRIPE_PRICE_GROWTH_YEARLY`, `STRIPE_PRICE_AGENCY_YEARLY`. See [annual setup](YEARLY_SUBSCRIPTIONS.md); monthly usage limits do not change.
- `STRIPE_TRIAL_DAYS=7`
- `STRIPE_PAYMENT_GRACE_DAYS=7`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (a sender on a Resend-verified domain)
- `ACTIVATION_TICKET_TTL_SECONDS=1800`
- `ACTIVATION_SESSION_TTL_SECONDS=14400`

Register `POST https://<gateway-host>/webhooks/stripe` as a Stripe webhook. Subscribe it to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`. The Egg gateway verifies Stripe's timestamped `v1` signature against the exact raw request body before parsing it. Checkout activation requires server-created workspace, owner, and plan metadata and reads the subscription's actual Stripe trial end; cancellation removes paid entitlement immediately; payment failure moves the workspace into a seven-day approval-only grace period before it pauses. Event IDs are stored in `billing_webhook_event`, so retries are idempotent.

After activation, the gateway creates a 30-minute, single-use ticket and sends it to the workspace owner's account email through Resend. Only the ticket hash is stored. `POST /api/activation/exchange` consumes the ticket transactionally and returns a four-hour owner access token; the website stores it in `sessionStorage`, removes the ticket from browser history by replacing the page with `/app`, and never puts the Resend or Stripe secrets in the frontend bundle. A failed email delivery returns an error to Stripe so its normal webhook retry can deliver the same deterministic ticket without reapplying billing.

Build the public website with `VITE_GATEWAY_URL=https://<gateway-host>` and set `CORS_ORIGINS` to the public site origin. The gateway and the webhook endpoint must be reachable over HTTPS in production.

New workspaces begin `inactive` and cannot start billable AI or publish work until Stripe activates them. The existing entitlement mutation endpoint is retained only for controlled back-office recovery. `/app/admin` adds a cross-workspace entitlement view; both routes require a signed owner/admin session and the private `BILLING_ADMIN_TOKEN`. The operator may enter that secret into the admin page over HTTPS, but it must never be compiled into the frontend, persisted in browser storage, or included in a URL.
