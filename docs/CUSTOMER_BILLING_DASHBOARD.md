# Customer billing dashboard

The platform opens on Dashboard. Subscription/usage information and billing recovery remain accessible while automation is paused. The workspace owner manages payment methods, invoices, available upgrades, cancellation and resumption through Stripe Customer Portal. Other roles with billing-view permission can inspect usage but cannot create payment sessions.

## Deployment

1. Back up PostgreSQL and apply all migrations, including `0018_credit_topups.sql`, before restarting the platform. This migration converts the old monthly purchased allowance to its remaining balance; purchased credits no longer reset at month boundaries. Do not replay it manually or roll back application code while continuing to accept top-ups.
2. Set platform `STRIPE_PRICE_AI_CREDITS=price_1U6pKsRuamqOc0mslHnpODAJ`. Verify in the same Stripe account/mode as `STRIPE_SECRET_KEY` that this is an active, one-time USD customer-chooses-price Price with minimum **1000 cents ($10)** and maximum **100000 cents ($1000)**. The server refuses checkout if these constraints differ. No live Stripe settings were changed by this PR.
3. Configure Stripe Customer Portal in that account/mode: payment methods, invoices, cancellation and permitted subscription changes; include the appropriate monthly/yearly products and Prices. Stripe controls which actions are available and their proration behavior. Confirm those settings in test mode before allowing customer upgrades. Configure all six subscription Price IDs on the platform so portal changes can map back to the correct entitlement.
4. Keep the signed platform webhook enabled for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, the existing subscription lifecycle events and invoice events. Subscription updates retrieve current Stripe state and map its current Price, rather than trusting an old metadata plan. Refreshing Dashboard also reconciles the linked subscription.
5. Ensure `PUBLIC_SITE_URL` points to the deployed website. Portal returns to `/app?section=dashboard`; top-up returns carry an opaque Checkout Session ID and are verified server-side.

## Credit accounting

- $1 buys 100 AI credits. One USD cent equals one credit; no floating-point currency conversion is used.
- Only completed, paid one-time sessions with the configured Price, exact tenant/customer binding and no taxes/discount discrepancy are fulfilled. A success URL alone never grants credits.
- Return-page confirmation and webhook fulfillment share a unique payment ledger. Retries cannot credit the same session twice. Balance writes lock the workspace billing row.
- Included monthly credits are consumed first, then the durable purchased balance. Duplicate reservation inserts cannot debit that balance twice.
- Refund notifications retrieve the current cumulative refunded amount. Duplicate or older notifications do not debit again. Credits already spent become refund debt, deducted from subsequent top-ups. No customer is automatically charged to settle debt.
- A trial remains **7 days or 30 cumulative AI credits**, whichever is reached first. Purchased credits do not bypass trial, subscription, task or supplier-safety limits.
- Disputes/chargebacks are not automatically processed as refunds; operators must review these separately. Stripe receipts and invoices remain the financial source of truth.

## Verification

Unit tests cover amount bounds, paid-only fulfillment, tenant/customer/Price validation, owner permissions, checkout configuration and refund idempotency/debt. Egg tests cover authenticated routing. The disposable PostgreSQL auth regression also applies migration 0018 and exercises rollover, duplicate fulfillment/reservation, refunds, debt settlement and the zero-credit execution stop.

Before live launch, use Stripe test mode to complete a $10 top-up, replay its webhook, return to Dashboard, partially/full refund it, and verify balances. Test portal upgrade/cancellation/resumption and refresh. These external end-to-end operations are not replaced by mocked provider tests or CI and have not been run against a live customer.

References: [Customer Portal setup](https://docs.stripe.com/customer-management/integrate-customer-portal), [customer-chosen amounts](https://docs.stripe.com/payments/checkout/pay-what-you-want), [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment).
