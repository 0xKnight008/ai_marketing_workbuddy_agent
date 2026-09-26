import { randomBytes } from 'node:crypto';
import type { TenantTransaction } from '../foundation/database';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function referralCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export async function activeReferralLink(tx: TenantTransaction): Promise<{ code: string }> {
  const existing = await tx.query<{ code: string }>('SELECT code FROM referral_link WHERE workspace_id = current_setting(\'app.workspace_id\')::uuid AND revoked_at IS NULL');
  if (existing.rows[0]) return existing.rows[0];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const created = await tx.query<{ code: string }>('INSERT INTO referral_link (workspace_id, code) VALUES (current_setting(\'app.workspace_id\')::uuid, $1) ON CONFLICT DO NOTHING RETURNING code', [referralCode()]);
    if (created.rows[0]) return created.rows[0];
    const winner = await tx.query<{ code: string }>('SELECT code FROM referral_link WHERE workspace_id = current_setting(\'app.workspace_id\')::uuid AND revoked_at IS NULL');
    if (winner.rows[0]) return winner.rows[0];
  }
  throw new Error('referral_code_generation_failed');
}

export async function referralSummary(tx: TenantTransaction, offset = 0): Promise<unknown> {
  const link = await tx.query<{ code: string }>("SELECT code FROM referral_link WHERE workspace_id = current_setting('app.workspace_id')::uuid AND revoked_at IS NULL");
  const totals = await tx.query(`
    SELECT (SELECT count(*) FROM referral_attribution WHERE referrer_workspace_id = current_setting('app.workspace_id')::uuid)::text AS attributed,
      currency,
      COALESCE(sum(amount_micros) FILTER (WHERE status IN ('pending','issuing')), 0)::text AS pending,
      COALESCE(sum(amount_micros) FILTER (WHERE status = 'available'), 0)::text AS available,
      COALESCE(sum(amount_micros) FILTER (WHERE stripe_balance_txn IS NOT NULL), 0)::text AS credited,
      COALESCE(sum(amount_micros) FILTER (WHERE status = 'reversal_pending'), 0)::text AS reversalPending,
      COALESCE(sum(amount_micros) FILTER (WHERE status = 'clawed_back'), 0)::text AS reversed
    FROM referral_credit_ledger WHERE workspace_id = current_setting('app.workspace_id')::uuid GROUP BY currency`);
  const entries = await tx.query(`SELECT a.id AS "attributionId", a.referred_workspace_id AS "referredWorkspaceId",
    a.attributed_at::text AS "attributedAt", l.id AS "ledgerId", l.stripe_invoice_id AS "invoiceId",
    l.amount_micros::text AS "amountMicros", l.currency, l.status
    FROM referral_attribution a LEFT JOIN referral_credit_ledger l ON l.attribution_id = a.id
    WHERE a.referrer_workspace_id = current_setting('app.workspace_id')::uuid
    ORDER BY a.attributed_at DESC, a.id, l.id LIMIT 50 OFFSET $1`, [offset]);
  const count = await tx.query(`SELECT count(*)::text AS attributed FROM referral_attribution
    WHERE referrer_workspace_id = current_setting('app.workspace_id')::uuid`);
  return { code: link.rows[0]?.code, attributed: count.rows[0]?.attributed ?? '0', currencies: totals.rows, entries: entries.rows, offset };
}
