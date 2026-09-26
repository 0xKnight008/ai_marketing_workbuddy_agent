import { useState } from 'react';

interface Summary {
  attributed: string;
  currencies: Array<{ currency: string; pending: string; available: string; credited: string; reversalpending: string; reversed: string }>;
  entries: Array<{ attributionId: string; referredWorkspaceId: string; ledgerId: string | null; invoiceId: string | null; amountMicros: string | null; currency: string | null; status: string | null }>;
}
// Keep database bigint amounts exact; no floating-point conversion for balances.
export function referralMoney(micros: string): string {
  const cents = BigInt(micros) / 10000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function ReferralLedger({ gatewayUrl, headers }: { gatewayUrl: string; headers: () => HeadersInit }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(page: number) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${gatewayUrl}/api/referral/summary?offset=${page}`, { headers: headers() });
      if (!response.ok) throw new Error('Unable to load referral ledger. Owner or admin access is required.');
      setSummary(await response.json() as Summary); setOffset(page);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load ledger.'); }
    finally { setBusy(false); }
  }
  return <section className="sketch bg-paper-card p-5 mt-6">
    <h2 className="text-lg font-semibold">Referral rewards</h2>
    <p className="mt-2 text-sm">20% of eligible first-year USD payments, capped at $2,000 per rolling year. Rewards round down to cents and wait 30 days. Any refund reverses the full reward. Referees receive no additional reward.</p>
    <button className="my-3 rounded border px-3 py-2" disabled={busy} onClick={() => void load(0)}>Refresh ledger</button>
    {error && <p role="alert">{error}</p>}
    {summary && <>
      <p>Attributed workspaces: {summary.attributed}</p>
      {summary.currencies.map(row => <p key={row.currency} className="my-2 text-sm">{row.currency.toUpperCase()} — Pending/issuing: {referralMoney(row.pending)} · Available: {referralMoney(row.available)} · Total issued: {referralMoney(row.credited)} · Awaiting reversal: {referralMoney(row.reversalpending)} · Reversed: {referralMoney(row.reversed)}</p>)}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Referred workspace</th><th>Invoice</th><th>Reward</th><th>Status</th></tr></thead><tbody>
        {summary.entries.map(row => <tr key={row.ledgerId ?? row.attributionId}><td className="py-2">{row.referredWorkspaceId}</td><td>{row.invoiceId ?? '—'}</td><td>{row.amountMicros ? `${row.currency?.toUpperCase()} ${referralMoney(row.amountMicros)}` : '—'}</td><td>{row.status ?? 'Awaiting eligible invoice'}</td></tr>)}
      </tbody></table></div>
      <div className="mt-3 flex gap-4"><button disabled={busy || !offset} onClick={() => void load(offset - 50)}>Previous</button><span>Page {offset / 50 + 1}</span><button disabled={busy || summary.entries.length < 50} onClick={() => void load(offset + 50)}>Next</button></div>
    </>}
  </section>;
}
