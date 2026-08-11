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
    try {
      const created = await tx.query<{ code: string }>('INSERT INTO referral_link (workspace_id, code) VALUES (current_setting(\'app.workspace_id\')::uuid, $1) RETURNING code', [referralCode()]);
      if (created.rows[0]) return created.rows[0];
    } catch (error) { if ((error as { code?: string }).code !== '23505' || attempt === 2) throw error; }
  }
  throw new Error('referral_code_generation_failed');
}

export async function referralSummary(tx: TenantTransaction): Promise<unknown> {
  const link = await activeReferralLink(tx);
  const totals = await tx.query<{ attributed: string; pending: string; available: string; credited: string }>(`
    SELECT (SELECT count(*) FROM referral_attribution WHERE referrer_workspace_id = current_setting('app.workspace_id')::uuid)::text AS attributed,
      COALESCE(sum(amount_micros) FILTER (WHERE status = 'pending'), 0)::text AS pending,
      COALESCE(sum(amount_micros) FILTER (WHERE status = 'available'), 0)::text AS available,
      COALESCE(sum(amount_micros) FILTER (WHERE status = 'clawed_back'), 0)::text AS credited
    FROM referral_credit_ledger WHERE workspace_id = current_setting('app.workspace_id')::uuid`);
  return { code: link.code, ...(totals.rows[0] ?? { attributed: '0', pending: '0', available: '0', credited: '0' }) };
}
