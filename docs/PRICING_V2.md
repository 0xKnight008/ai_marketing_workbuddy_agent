# Pricing v2 and cost guardrails

## Customer-facing plans

| Plan | Price | Connected accounts | Monthly tasks | Included AI credits | Monthly supplier-spend limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| Creator | $19 | 2 | 2,000 | 400 | $6 |
| Growth | $59 | 10 | 10,000 | 2,500 | $20 |
| Agency | $169 | 30 | 50,000 | 8,000 | $55 |

The public trial is 7 days with 30 Eco credits. Stripe Checkout and the verified webhook activation block in this repository issue that trial entitlement for the selected plan.

An AI-credit top-up is $10 per 1,000 credits. The payment webhook must call the owner-only `POST /api/billing/entitlements` endpoint after it has verified payment. That endpoint accepts a plan change and/or credits in 1,000-credit increments; it never processes payment details.

## AI routing

| Band | Credits/run | Input cap | Output cap | Target cap | Estimated supplier cost/run |
| --- | ---: | ---: | ---: | ---: | ---: |
| Eco | 1 | 8K tokens | 1.5K tokens | 5 | $0.002 |
| Standard | 6 | 16K tokens | 2K tokens | 10 | $0.035 |
| Flagship | 20 | 32K tokens | 4K tokens | 20 | $0.15 |

The platform maps `allowedModelClasses` to the highest requested band and the AI runtime selects its matching configured model: `AI_MODEL_ECO`, `AI_MODEL_STANDARD`, or `AI_MODEL_FLAGSHIP`. Input, output, and target caps are checked in the runtime. If the requested premium band cannot be covered by remaining credits, the run automatically uses Eco instead. Eco runs remain available at zero remaining credits, subject to the two cost guardrails below.

## Cost guardrails

Each workspace has two independent monthly meters:

- **Task quota:** successful external actions. Most actions cost one task; X writes cost three.
- **Supplier spend:** the estimated AI run cost, $0.01 per X write, and the monthly marginal cost of connected Zernio accounts. Zernio bills Piggybot as one aggregated platform tenant, so each connected account is budgeted at **$1.50/month**; the public single-tenant Zernio retail tiers do not apply to an individual Piggybot workspace.

At 80% of either meter, the platform emits an audit event and requires approval before the next publish. At 100%, it pauses new AI runs and publishes before any external provider call. Triggers, filters, and approval notifications remain free. An owner plan change resumes runs once the new plan puts both meters below their hard limit; an AI-credit top-up only changes premium-model capacity.

Usage is recorded in `task_event`, with AI credits and supplier costs stored beside task units. The guardrail events are recorded in `run_event` and `audit_event`, and action execution retains its existing step and provider idempotency keys.

## Operations

Apply `platform/migrations/0004_pricing_v2_guardrails.sql`, `platform/migrations/0005_billing_subscription_lifecycle.sql`, and `platform/migrations/0011_activation_delivery.sql` before deploying the platform services. Configure all three model environment variables in the AI runtime. The `GET /api/billing/usage` endpoint returns the current plan, quota usage, credits, supplier spend, and guardrail status; `GET /api/billing/task-events` returns its detailed ledger.

## Stripe account activation

The public pricing buttons lead to `/activate?plan=creator|growth|agency`. The checkout page uses an existing short-lived **workspace owner** token to establish which workspace will be upgraded; it keeps a manually pasted token only in browser memory and sends it to the gateway over HTTPS to create a Checkout Session.

Configure these gateway environment variables with recurring Stripe Price IDs for the three plans:

- `PUBLIC_SITE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_CREATOR`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_AGENCY`
- `STRIPE_TRIAL_DAYS=7`
- `STRIPE_PAYMENT_GRACE_DAYS=7`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (a sender on a Resend-verified domain)
- `ACTIVATION_TICKET_TTL_SECONDS=1800`
- `ACTIVATION_SESSION_TTL_SECONDS=14400`

Register `POST https://<gateway-host>/webhooks/stripe` as a Stripe webhook. Subscribe it to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`. The Egg gateway verifies Stripe's timestamped `v1` signature against the exact raw request body before parsing it. Checkout activation requires server-created workspace, owner, and plan metadata and reads the subscription's actual Stripe trial end; cancellation removes paid entitlement immediately; payment failure moves the workspace into a seven-day approval-only grace period before it pauses. Event IDs are stored in `billing_webhook_event`, so retries are idempotent.

After activation, the gateway creates a 30-minute, single-use ticket and sends it to the workspace owner's account email through Resend. Only the ticket hash is stored. `POST /api/activation/exchange` consumes the ticket transactionally and returns a four-hour owner access token; the website stores it in `sessionStorage`, removes the ticket from browser history by replacing the page with `/app`, and never puts the Resend or Stripe secrets in the frontend bundle. A failed email delivery returns an error to Stripe so its normal webhook retry can deliver the same deterministic ticket without reapplying billing.

Build the public website with `VITE_GATEWAY_URL=https://<gateway-host>` and set `CORS_ORIGINS` to the public site origin. The gateway and the webhook endpoint must be reachable over HTTPS in production.

New workspaces begin `inactive` and cannot start billable AI or publish work until Stripe activates them. The existing entitlement mutation endpoint is retained only for controlled back-office recovery and now also requires the private `BILLING_ADMIN_TOKEN`; do not expose that token to the browser.
