# Failed AI reservation refunds

## Accounting policy

Migration **0039_ai_reservation_refunds.sql** adds reservation state, generation,
funding allocation, original credit period, and a unique refund reference to
`task_event`. Existing succeeded/reversed ledger rows are retained. No table is
recreated and no Stripe subscription/payment is changed by an AI-credit refund.

New calls reserve credits before the model request. A valid result settles the
reservation in the same transaction that stores it. A final model failure,
rejected/ungrounded output or compliance-blocked announcement releases unused
reservations with a **separate, linked `reversed` credit entry**, once. Valid
search/classification/topic chunks already saved stay settled if a later step
fails. Publishing/email failure or a user's rejection of valid output does not
refund completed AI generation. A retry waiting in the queue keeps its existing
reservation; it does not refund and charge on every transient provider error.

Refunds return trial carryover and purchased credits to their original buckets,
while included credits are restored through net period usage. Purchased refunds
first offset any topup chargeback debt. Refund credit periods match original
debits, so a late prior-month refund cannot invent a current-month allowance.
Supplier spend is retained: Piggybot may still owe the provider for bad output.
Billing-row locks and a unique `reversal_of` index prevent races. A deliberate
retry after refund reserves anew; all charge/refund cycles remain auditable.

Failed callbacks and terminal worker paths refund automatically. Balance reads
also reconcile terminal reservations left by worker crashes/expired leases;
live queued/running retries and settled outputs are excluded. Activity shows
signed debit/refund amounts and reservation state in en/zh/es. Execution history
retains the actual attempted band and reports zero net credits for refunded calls.

## Historical 20-credit reservation

Old versions did **not** record which purchased credits funded a debit. The
migration marks failed pre-approval workflow reservations for reconciliation,
but never guesses historical purchased allocation. Other old AI records are
kept settled to avoid refunding useful completed work. Unknown allocations are
flagged `ai.refund_review_required`. Use the operator-only helper below for the
reported failed Flagship run; it has no customer HTTP endpoint.

After deployment/migration, preview against the production protected env:

```bash
cd /opt/ai-marketing-agent/platform
NODE_BIN="$(command -v node)"
WORKSPACE_ID='replace-with-the-verified-workspace-uuid'
RUN_ID='replace-with-the-failed-workflow-run-uuid'
sudo "$NODE_BIN" --env-file=/etc/piggybot/platform.env --import tsx src/billing/repair-ai-refund-cli.ts \
  --workspace "$WORKSPACE_ID" \
  --run "$RUN_ID"
```

Use the durable workflow run UUID, not its canonical workspace-task wrapper UUID.
Verify the preview is **20 credits**, the run is
still failed before approval, and verify its purchased allocation from billing
records. If all 20 were included subscription credits (`purchased=0`), apply:

```bash
sudo "$NODE_BIN" --env-file=/etc/piggybot/platform.env --import tsx src/billing/repair-ai-refund-cli.ts \
  --workspace "$WORKSPACE_ID" \
  --run "$RUN_ID" \
  --purchased-credits 0 \
  --reason 'Verified failed Flagship generation before approval; included-plan allocation' \
  --apply
```

Do not assume allocation zero merely because the amount is 20. Supply the
verified purchased portion if different. The helper fails closed for successful
or approved output, missing/ambiguous reservations and absent allocations.
Preview is read-only; applying records allocation reason, linked refund and audit.
Repeating a completed repair returns `already_refunded` and grants nothing.
This PR does not run the production repair or start paid task retries.

## Validation

Real PostgreSQL tests cover concurrent callbacks, 20-credit restoration, mixed
funding, trial handoff, cross-month refunds, settled-result retention, tenant
isolation, explicit retry charging, crash reconciliation and historical repair.
Playwright covers signed 20-credit refund presentation in all three languages.
