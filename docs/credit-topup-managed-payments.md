# AI credit top-up: standard Checkout

The production account defaults to Managed Payments. Stripe rejected top-up
Checkout creation with HTTP 400 because the existing request explicitly sets
`payment_method_types[0]=card`. Piggybot wrapped that rejection as HTTP 502.

As approved, only AI-credit top-up Checkout creation now sends
`managed_payments[enabled]=false`. The card-only standard Checkout flow remains;
no account default, subscription checkout, or Customer Portal setting is changed.
This is not a migration to Managed Payments or an implementation of tax handling.

The $10–$1,000 limits, $1 = 100 credits conversion, paid-session verification,
tenant checks, idempotent crediting, and refund handling remain unchanged.
No database migration or new environment variable is required.

## Verification and rollout

- Regression tests simulate Stripe's reported account-default rejection for both
  active and trial owners, and require the explicit session-level opt-out.
- Existing payment/tenant/amount/idempotency/refund tests remain in place.
- After deployment, opening Add AI Credits should reach standard Stripe Checkout.
  Opening Checkout alone must not add credits. Do not complete a live payment just
  to smoke-test the redirect.
- Payment completion, repeated webhook delivery, and refund acceptance should be
  tested in Stripe test mode before relying on production fulfillment. Local mocks
  are not a substitute for Stripe acceptance testing.

Upgrade Plan is separate: enable subscription updates and allowed recurring prices
in the default Customer Portal configuration. This patch does not enable them.

Reference: https://docs.stripe.com/payments/managed-payments/update-checkout
