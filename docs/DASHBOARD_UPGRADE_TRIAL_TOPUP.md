# Dashboard upgrade and trial top-ups

- Upgrade Plan sits beside the current plan. It opens Stripe's `subscription_update` portal flow for the server-bound subscription, not a new subscription checkout. Only the owner can open it.
- In Stripe Customer Portal configuration, enable subscription updates and configure the Creator/Growth/Agency monthly and yearly Prices you want customers to choose. Stripe displays payment/proration consequences and asks the customer to confirm; this PR makes no automatic plan changes.
- Trial owners with a linked Stripe customer can buy AI credits. The old code already allowed trials but silently disabled the button if customer binding, ownership or `STRIPE_PRICE_AI_CREDITS` was missing. Disabled states now explain why.
- The approved Piggybot Price `price_1U6pKsRuamqOc0mslHnpODAJ` is the default when the environment override is absent/blank. Other Stripe accounts and test mode must explicitly configure their matching Price. Every checkout still verifies an active one-time USD custom-amount Price with minimum $10 and maximum $1000. Server-side Stripe credentials remain required.
- Buying credits does not change the trial's original end date, clear cumulative usage or bypass its 30-credit limit. Credits are granted only after verified payment and remain in the wallet for use with eligible subscription access.
- Real customer binding and Stripe portal settings must be validated after deployment. No live charges, portal configuration changes or subscription changes were performed during testing.

Reference: https://docs.stripe.com/customer-management/portal-deep-links
