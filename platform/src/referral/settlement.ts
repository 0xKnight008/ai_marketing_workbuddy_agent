import type { ClaimedJob, RunWorkerDatabase } from '../run-service/worker-runner';

interface Credit {
  status: string; amountMicros: string; currency: string; customerId: string | null;
  startedAt: string | null;
}

export function referralCents(micros: string, currency: string): number {
  const amount = BigInt(micros);
  if (currency !== 'usd' || amount <= 0n || amount % 10000n !== 0n || amount > 2000000000n) {
    throw new Error('referral_amount_requires_reconciliation');
  }
  return Number(amount / 10000n);
}

/** Stripe keeps idempotency keys for at least 24h; unknown older outcomes must
 * be reconciled by an operator, never retried as a potentially new payment. */
export function assertReferralRetryWindow(startedAt: string | null, now = Date.now()): void {
  if (!startedAt || !Number.isFinite(Date.parse(startedAt)) || now - Date.parse(startedAt) >= 20 * 3600000) {
    throw new Error('referral_settlement_requires_reconciliation');
  }
}

export async function settleReferral(database: RunWorkerDatabase, job: ClaimedJob, secret: string | undefined, reverse = false): Promise<void> {
  const invoiceId = job.payload.invoiceId;
  if (typeof invoiceId !== 'string' || !invoiceId || !secret) throw new Error('referral_settlement_not_configured');
  const startedColumn = reverse ? 'reversal_started_at' : 'issuing_started_at';
  const credit = await database.withWorkspace(job.workspaceId, async tx => {
    const result = await tx.query<Credit>(`
      SELECT l.status, l.amount_micros::text AS "amountMicros", l.currency,
        COALESCE(l.stripe_customer_id, b.stripe_customer_id) AS "customerId",
        l.${startedColumn}::text AS "startedAt"
      FROM referral_credit_ledger l LEFT JOIN workspace_billing b ON b.workspace_id = l.workspace_id
      WHERE l.workspace_id = current_setting('app.workspace_id')::uuid AND l.stripe_invoice_id = $1
      FOR UPDATE OF l`, [invoiceId]);
    const row = result.rows[0];
    if (!row) throw new Error('referral_ledger_missing');
    if (!(reverse ? ['reversal_pending'] : ['pending', 'issuing']).includes(row.status)) return undefined;
    if (!row.customerId) throw new Error('referral_customer_unavailable');
    referralCents(row.amountMicros, row.currency);
    // A claim becomes durable before the network call; refunds now record intent.
    const updated = await tx.query<{ startedAt: string }>(`
      UPDATE referral_credit_ledger SET ${startedColumn} = COALESCE(${startedColumn}, now()),
        stripe_customer_id = COALESCE(stripe_customer_id, $2), status = $3
      WHERE workspace_id = current_setting('app.workspace_id')::uuid AND stripe_invoice_id = $1
        AND ($4::boolean OR available_at <= now())
      RETURNING ${startedColumn}::text AS "startedAt"`, [invoiceId, row.customerId, reverse ? 'reversal_pending' : 'issuing', reverse]);
    if (!updated.rows[0]) throw new Error('referral_credit_not_due');
    return { ...row, startedAt: updated.rows[0].startedAt };
  });
  if (credit) {
    assertReferralRetryWindow(credit.startedAt);
    const cents = referralCents(credit.amountMicros, credit.currency);
    const response = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(credit.customerId!)}/balance_transactions`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': `referral-${reverse ? 'clawback' : 'credit'}:${invoiceId}` },
      body: new URLSearchParams({ amount: String(reverse ? cents : -cents), currency: credit.currency,
        description: `Piggybot referral ${reverse ? 'reversal' : 'credit'} for ${invoiceId}`,
        'metadata[referral_invoice_id]': invoiceId }),
    });
    const body = await response.json().catch(() => ({})) as { id?: unknown };
    if (!response.ok || typeof body.id !== 'string') throw new Error('referral_stripe_settlement_failed');
    await database.withWorkspace(job.workspaceId, async tx => {
      const result = await tx.query<{ status: string }>(reverse ? `
        UPDATE referral_credit_ledger SET status = 'clawed_back', stripe_reversal_txn = $2
        WHERE workspace_id = current_setting('app.workspace_id')::uuid AND stripe_invoice_id = $1
          AND status = 'reversal_pending' RETURNING status` : `
        UPDATE referral_credit_ledger SET status = CASE WHEN reversal_requested THEN 'reversal_pending' ELSE 'available' END,
          stripe_balance_txn = $2
        WHERE workspace_id = current_setting('app.workspace_id')::uuid AND stripe_invoice_id = $1
          AND status = 'issuing' RETURNING status`, [invoiceId, body.id]);
      if (result.rows[0]?.status === 'reversal_pending') {
        await tx.query(`INSERT INTO job(workspace_id, kind, payload, max_attempts)
          VALUES ($1, 'clawback_referral_credit', $2, 5)`, [job.workspaceId, { invoiceId }]);
      }
      // A competing retry may already have committed this same Stripe result.
      if (!result.rowCount) {
        const recorded = await tx.query(`SELECT id FROM referral_credit_ledger
          WHERE workspace_id = current_setting('app.workspace_id')::uuid AND stripe_invoice_id = $1
            AND ${reverse ? 'stripe_reversal_txn' : 'stripe_balance_txn'} = $2`, [invoiceId, body.id]);
        if (!recorded.rowCount) throw new Error('referral_settlement_conflict');
      }
    });
  }
  await database.withWorkspace(job.workspaceId, tx => tx.query(`UPDATE job
    SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE id = $1 AND workspace_id = $2 AND status = 'running' AND attempt = $3`, [job.id, job.workspaceId, job.attempt]));
}
