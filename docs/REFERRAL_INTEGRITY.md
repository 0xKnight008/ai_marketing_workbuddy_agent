# Referral integrity and rollout

Confirmed policy: USD only; 20% of eligible first-year payments; $2,000 rolling
12-month referrer cap; 30-day holding period; round rewards DOWN to whole cents
before ledger insertion. Any refund cancels the entire reward, even partial
refunds. No extra referee credit/discount is created. Existing last-touch 30-day
short-link cookie is used when Checkout has no explicit code; once attributed,
a workspace cannot be rebound. Shared authenticated owners cannot self-refer
across workspaces; this does not claim to detect people using unrelated accounts.

The website must proxy `/api/referral/context` to the platform (covered by the
existing nginx `/api/` rule). This authenticated, no-store read resolves the
website's host-only cookie before sending Checkout to a different API hostname;
it does not broaden the cookie domain or expose session credentials.

## Migration and workers

Deploy `0034_referral_integrity.sql` before the new application. Pause **all old
workers** during migration/deploy; do not run old settlement code against the new
state machine. Back up the database first. The migration is additive except for
extending the ledger status constraint. Do not downgrade workers afterwards.

- Invoice/refund facts survive reordering. Attribution replays unprocessed facts;
  duplicate invoice IDs are immutable. Checkout return and invoice subscription
  metadata also bind attribution (no dependency on a single checkout webhook).
- Per-referee locks serialize binding/intake; per-referrer locks serialize the
  cap. Issuing and reversal-pending rewards continue to reserve cap until the
  reversal actually succeeds.
- `pending → issuing → available`. A refund during issuance records intent,
  then successful issuance queues `reversal_pending → clawed_back`.
- Freeze the Stripe customer and exact amount before POST. Repeat attempts use
  the same idempotency key. Provider-success/DB-failure retries are recoverable.
- Unknown outcomes at/after 20 hours **fail closed** with
  `referral_settlement_requires_reconciliation`. Never reset the started-at
  timestamp or change the key simply to get a job through. Stripe may prune keys
  after 24 hours: https://docs.stripe.com/api/idempotent_requests.

## Historical records and manual reconciliation

The migration does NOT claim to reconcile existing production balances or recover
old dropped webhooks. Previously attempted pending issues and unfinished legacy
clawbacks are frozen with a sentinel start time, not blindly retried. Historical
fractional-cent/non-USD pending records also fail closed. Historical `void` rows
may have escaped the old race and require inspection, even if no job is pending.

In Stripe **test mode first**, inspect the customer's complete balance transaction
history and request logs by invoice ID/idempotency key. Verify customer, currency,
signed amount and provider transaction ID. For a verified successful external
operation, record its transaction ID and correct state atomically, creating a
reversal job when refund intent exists. If provider outcome cannot be established,
leave blocked. Correcting production ledger/Stripe balances needs separate explicit
operator approval; no automatic historical writes are provided by this PR.

Keep the original key/body when replaying legacy operations; old clawback bodies
did not contain referral metadata. Do not replay them through the new worker.

## Visibility and validation

User Settings exposes per-currency pending, available, total issued, awaiting
reversal and reversed balances plus paginated referee workspace/invoice records.
These are workspace identifiers, not recipient email addresses. Summary GET is
read-only. Admin ledger supports deterministic pagination without the former
100-workspace/100-record truncation. Historical display is still ledger evidence,
not proof of provider reconciliation.

Real PostgreSQL coverage runs within `tests-postgres/auth-schema.test.ts` against
an empty disposable DB: concurrent link creation, concurrent cap, duplicate and
out-of-order invoices/refunds, immutable attribution, shared-owner self referral,
tenant-scoped summaries, USD/rounding/overflow, in-flight refunds, failed reversal,
provider-success/commit-failure replay and expired idempotency protection.
Stripe network calls are mocked; no real customer balance is changed. Browser
coverage is `tests-browser/referral-ledger.spec.ts`. A Stripe test-mode acceptance
and authorized production read-only reconciliation remain separate release gates.
