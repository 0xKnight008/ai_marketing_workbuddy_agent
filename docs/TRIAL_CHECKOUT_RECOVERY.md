# Trial checkout activation

The previous return page displayed success based only on `?checkout=success` and never synchronized the Checkout Session. A delayed/missing webhook left the workspace inactive. A Customer appearing in Stripe is not proof of a completed subscription: free trials have a Subscription ID and `trialing` status even before their first charge.

The return page now sends only the opaque `cs_…` ID to authenticated `POST /api/billing/checkout-session/confirm`. The server retrieves the Session and Subscription directly from Stripe, validates workspace ownership, completion, subscription mode, customer association and current active/unexpired trial status, and applies the entitlement transactionally. Duplicate confirmations do not allocate anything twice, and a stale session cannot replace a different stored subscription. Stripe webhooks remain required for renewals, cancellations, payment failures and customers who never return to the site.

The page reports verification/retry/sign-in states rather than claiming a charge occurred. The existing login return path preserves the Session ID. The platform refreshes identity and usage on focus and uses current billing status when refreshing usage.

An owner can also use **Check / resume checkout** from the paused platform screen. The server resolves the latest Session from that workspace's checkout audit record (not a browser-supplied Customer ID), reads its current Stripe status, resumes an open Stripe-hosted checkout, reports an expired/missing checkout, or confirms a completed one. A completed Session without a Subscription ID remains an error. Existing code already requests `mode=subscription`; the reported customer-only state still requires the real Session status/Stripe event timeline to establish whether the user abandoned checkout, it expired, or an unrelated flow created the Customer.

## Production checks

- In Stripe, open the affected Customer's Subscriptions section. Record the subscription status, trial end and `sub_…` ID; if there is no subscription, inspect whether Checkout completed or only a Customer was created. Do not manually grant an entitlement based on a Customer ID or email alone.
- Check that the Checkout Session has `workspaceId`, `actorId`, and `plan` metadata, and the Subscription has the same `workspaceId`. Use the authenticated in-app checkout; unrelated Payment Links may not carry these fields.
- Confirm the deployed platform has `STRIPE_SECRET_KEY` for the same Stripe account/mode, and configure the `/webhooks/stripe` endpoint with the matching signing secret and required lifecycle events. Never paste these secrets into logs/issues.
- Return through the original successful Checkout URL while signed into the owning workspace. Retry confirmation if a transient network error occurs. Do not purchase again simply because activation is delayed.
- Verify `/api/auth/me` and `/api/billing/usage`: an unexpired `trialing` workspace should not be paused solely for lack of an initial charge. Supplier-spend and other safety limits still apply.

The confirmed free-trial policy is seven days OR 30 cumulative AI credits, whichever comes first. Migration 0017 stores the trial start so crossing a calendar month does not replenish the trial. Purchased credits do not bypass its 30-credit cap. Apply migrations before starting the updated application. This repair does not manufacture a trial expiry, send a live payment or grant access from browser-provided payment fields.

References: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [subscription states](https://docs.stripe.com/billing/subscriptions/overview).
