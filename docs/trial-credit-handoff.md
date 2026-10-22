# Subscribed trial credit handoff

An existing Stripe trial subscription uses its 30 cumulative trial credits first.
If the next AI step exceeds the remaining free balance, the worker ends that
subscription's trial early at its existing price and billing interval. This can
start the first monthly or annual payment immediately. Checkout, Terms and the
workspace explain this behavior in English, Chinese and Spanish.

The worker retains the original job, model, source and paid steps. Only a verified
paid invoice unlocks the paid allowance. For example, with 10 trial credits left,
a Flagship step costs 10 trial credits and 10 paid credits after payment succeeds.
Trial usage does not subtract from the paid monthly allowance. Purchased credits
remain last in the spending order; task and supplier safety caps still apply.

A declined card, required authentication, canceled renewal, missing subscription
binding or unavailable Stripe response leaves the job waiting. The owner resolves
payment in Plan & usage / Stripe, then confirms the original model to resume.
Only an insufficient paid balance offers the existing cheaper-model/top-up flow.
The payment boundary is persisted before contacting Stripe so an early `active`
webhook cannot release unpaid credits. Stable Stripe operation keys, a one-time
handoff marker and locked workspace billing prevent repeat charges or refills.
Owner-initiated recovery has its own request key so a previous declined response
is not indefinitely replayed by Stripe idempotency.

## Deployment

Apply `platform/migrations/0038_trial_credit_handoff.sql` through the normal
migration runner before restarting the gateway and worker on this revision.
The migration adds a trial component to task events and records the pending
payment boundary and unused trial carryover in workspace billing. Historical
trial events are classified using their recorded trial window. Readiness checks
require the new columns. No production Stripe payment is made by deployment.

Validation uses Stripe responses and model providers stubbed locally; PostgreSQL
allocation, task execution, concurrency and recovery run against a disposable
real database. A Stripe test-mode payment/SCA check is still needed before
validating actual payment-provider behavior. Never use live customers for that
check. API reference: https://docs.stripe.com/api/subscriptions/update
