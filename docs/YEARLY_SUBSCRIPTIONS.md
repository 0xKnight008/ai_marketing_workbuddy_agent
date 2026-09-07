# Yearly subscription Prices

Checkout accepts `billingInterval: "month" | "year"`; omitted values remain
monthly for compatibility. Each plan keeps its existing monthly Price variable
and gets a separate annual one. Browser input never supplies the trusted Price
ID. The server selects it from the plan/interval allowlist.

## Operator configuration

Set these user-provided values in the **actual running platform environment**
(not a Vite/frontend secret, and not merely in the repository's example file):

```dotenv
STRIPE_PRICE_CREATOR_YEARLY=price_1U6pKvRuamqOc0msJSRDX5xt
STRIPE_PRICE_GROWTH_YEARLY=price_1U6pKsRuamqOc0msPBSaTDTP
STRIPE_PRICE_AGENCY_YEARLY=price_1U6pKuRuamqOc0msYvOuMPue
```

Keep `STRIPE_PRICE_CREATOR`, `STRIPE_PRICE_GROWTH`, and `STRIPE_PRICE_AGENCY`
for monthly billing. Use a STRIPE_SECRET_KEY from the same account and test/live
mode as the configured Prices. Reload/restart through the actual platform
process manager after configuring the environment. No database migration is
required. Existing subscriptions are not changed.

Before creating annual Checkout, the server reads the configured Stripe Price
and verifies it is active with `recurring.interval=year` and `interval_count=1`.
Missing annual configuration fails with `stripe_not_configured`; inaccessible
Prices fail with `stripe_price_lookup_failed`; nonannual/inactive Prices fail
with `stripe_annual_price_invalid`. There is no monthly fallback.

Annual amounts were not supplied and are not inferred from monthly prices.
The localized pricing/activation screens explicitly defer the annual total to
Stripe's confirmation page. No annual discount is promised. Stripe remains
the amount/currency source of truth. Monthly task/credit limits and existing
trial and subscription-entitlement checks are unchanged.

The selected interval survives pricing → activation → login/register →
activation and Stripe cancellation. Checkout and subscription metadata plus
the checkout audit record include the interval. Existing verified webhooks
still activate the plan and persist the actual subscription Price ID.

## Validation

Tests mock Stripe: six plan/interval combinations, legacy monthly defaults,
missing annual IDs, wrong interval/count/inactive/one-time Prices, failed Price
lookup, owner-only API validation, client Price-ID rejection, metadata, cancel
URLs and localized authentication return paths. No real Checkout, subscription
or charge was created. Verify account/mode and amounts with an operator-owned
Stripe test setup before enabling production purchase.

References: [Stripe Checkout creation](https://docs.stripe.com/api/checkout/sessions/create)
and [managing Prices](https://docs.stripe.com/products-prices/manage-prices).
