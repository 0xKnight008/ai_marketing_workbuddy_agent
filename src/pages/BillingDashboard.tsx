import { useCallback, useEffect, useState } from 'react';

interface BillingView {
  usage: { plan: string; subscriptionStatus: string; status: string; aiCreditsUsed: number; aiCreditsAvailable: number; taskUsed: number; taskQuota: number };
  subscription: null | { status: string; renewsAt: string | null; trialEndsAt: string | null; cancelAtPeriodEnd: boolean; amountCents: number | null; currency: string; interval: string };
  syncError: boolean; creditBalance: number; refundDebt: number; includedCredits: number; canManage: boolean; canUpgrade: boolean; canTopup: boolean; topupUnavailableReason: string | null;
  topups: { id: string; amountCents: number; credits: number; refundedCents: number; createdAt: string }[];
}
const button = 'rounded-md border border-ink/20 bg-paper-card px-4 py-3 text-sm font-medium disabled:opacity-50';
const card = 'rounded-xl border border-ink/20 bg-paper-card p-6';
const when = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not available';

export default function BillingDashboard({ token, gatewayUrl, onUsage }: { token: string; gatewayUrl: string; onUsage: (usage: BillingView['usage']) => void }) {
  const [data, setData] = useState<BillingView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [subscriptionId, setSubscriptionId] = useState('');
  async function recoverSubscription() {
    setBusy(true); setMessage('');
    try { await request('subscription/recover', { subscriptionId: subscriptionId.trim() }); await refresh(); setMessage('Stripe subscription verified. Original trial dates and usage limits apply.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Recovery failed.'); }
    finally { setBusy(false); }
  }
  const request = useCallback(async (path: string, body?: object) => {
    const response = await fetch(`${gatewayUrl}/api/billing/${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(response.status === 403 ? 'Only the workspace owner can manage billing. Ask your owner for help.' : 'Billing could not be verified. Please retry or contact support.');
    return response.json();
  }, [gatewayUrl, token]);
  const refresh = useCallback(async () => { const next = await request('dashboard') as BillingView; setData(next); onUsage(next.usage); }, [request, onUsage]);
  const reconcile = useCallback(async () => {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get('topup_session');
    if (sessionId) {
      await request('credit-topup/confirm', { sessionId });
      url.searchParams.delete('topup_session');
      window.history.replaceState(null, '', url);
      setMessage('Payment verified. Your credits are available in the balance below. Trial limits still apply.');
    }
    await refresh();
  }, [refresh, request]);
  useEffect(() => { void reconcile().catch((error: Error) => setMessage(error.message)); }, [reconcile]);
  useEffect(() => {
    const focus = () => { void refresh().catch((error: Error) => setMessage(error.message)); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  async function act(path?: string, body: Record<string, unknown> = {}) {
    setBusy(true); setMessage('');
    try {
      if (path) {
        const result = await request(path, body);
        const target = new URL(result.url);
        if (target.protocol !== 'https:' || !['billing.stripe.com', 'checkout.stripe.com'].includes(target.hostname)) throw new Error('Invalid payment redirect. Contact support.');
        window.location.assign(target.href);
      } else await reconcile();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Please retry.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-6" aria-label="Billing dashboard">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-display text-3xl">Dashboard</h2><p className="mt-2 text-ink-soft">Your subscription, AI credits and usage in one place.</p></div><button className={button} disabled={busy} onClick={() => void act()}>Refresh billing</button></div>
    {message && <p role="status" className="rounded-lg bg-sky-pale p-4">{message}</p>}
    {!data ? <p>Loading billing details…</p> : <>
      {data.syncError && <p role="alert">Stripe details are temporarily unavailable. The usage below is your last recorded entitlement; refresh to verify subscription changes.</p>}
      {data.usage.subscriptionStatus === 'inactive' && <div className={card}><h3 className="text-xl font-semibold">Already subscribed?</h3><p className="my-3 text-sm">The workspace owner can verify an existing Stripe subscription without purchasing again. Enter its sub_… ID; the server checks ownership, current status and original trial dates.</p><label className="block text-sm">Stripe subscription ID<input value={subscriptionId} onChange={event => setSubscriptionId(event.target.value)} className="my-3 block w-full rounded-md border border-ink/20 p-3" placeholder="sub_…" /></label><button className={button} disabled={busy || !subscriptionId.trim()} onClick={() => void recoverSubscription()}>Verify existing subscription</button></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-semibold capitalize">{data.usage.plan} plan</h3><button className={button} disabled={busy || !data.canUpgrade} onClick={() => void act('portal', { action: 'upgrade' })}>Upgrade Plan</button></div><p className="mt-3">Subscription: {data.subscription?.status ?? data.usage.subscriptionStatus}</p><p>Automation: {data.usage.status}</p>
          {data.subscription && <div className="mt-3 space-y-2 text-sm"><p>{data.subscription.cancelAtPeriodEnd ? 'Ends on' : 'Next billing date'}: {when(data.subscription.renewsAt)}</p>{data.subscription.status === 'trialing' && <p>Trial ends: {when(data.subscription.trialEndsAt)}</p>}{data.subscription.amountCents != null && <p>{(data.subscription.amountCents / 100).toLocaleString(undefined, { style: 'currency', currency: data.subscription.currency })} / {data.subscription.interval}</p>}</div>}
          <p className="my-4 text-sm text-ink-soft">Manage payment details, invoices, cancellation, renewal and available plan changes securely in Stripe. Only the workspace owner can make changes.</p>
          <button className={button} disabled={busy || !data.canManage} onClick={() => void act('portal')}>Manage subscription in Stripe</button>
        </div>
        <div className={card}><h3 className="text-xl font-semibold">AI credits</h3><p className="my-4 text-4xl font-display">{data.usage.aiCreditsAvailable.toLocaleString()} <span className="text-base">available</span></p>
          <label className="block text-sm">Included credits used: {Math.min(data.usage.aiCreditsUsed, data.includedCredits).toLocaleString()} / {data.includedCredits.toLocaleString()}<progress className="my-3 h-3 w-full" value={Math.min(data.usage.aiCreditsUsed, data.includedCredits)} max={data.includedCredits} /></label>
          <p>Purchased balance: {data.creditBalance.toLocaleString()} credits</p>{data.refundDebt > 0 && <p>Refund adjustment: {data.refundDebt} credits will be deducted from future top-ups.</p>}
          <p className="my-4 text-sm text-ink-soft">$1 = 100 AI credits. Choose $10–$1000 at checkout. Purchased credits carry over month to month. Top-ups do not extend a trial or reactivate a canceled subscription.</p>
          <button className={button} disabled={busy || !data.canTopup} onClick={() => void act('credit-topup')}>Add AI Credits</button>
          {!data.canTopup && <p className="mt-3 text-sm" role="status">{data.topupUnavailableReason === 'owner_required' ? 'Only the workspace owner can purchase credits.' : data.topupUnavailableReason === 'stripe_customer_not_linked' ? 'Verify your existing subscription above to link your Stripe customer before adding credits.' : 'Credit checkout is not configured. Contact support.'}</p>}
          {data.usage.subscriptionStatus === 'trialing' && <p className="mt-3 text-sm">Trial accounts can purchase credits. Purchases stay in your wallet; they do not extend the 7-day / 30-credit trial or unlock paused automation. Upgrade your plan to use credits beyond the trial limit.</p>}
        </div>
      </div>
      <div className={card}><h3 className="text-xl font-semibold">Usage status</h3><p className="mt-3">{data.usage.subscriptionStatus === 'trialing' ? 'Trial AI usage is cumulative: 7 days or 30 AI credits, whichever comes first.' : 'Included allowances reset each calendar month; purchased credits do not reset.'}</p><p className="mt-2">Tasks this month: {data.usage.taskUsed.toLocaleString()} / {data.usage.taskQuota.toLocaleString()}</p><p className="mt-2 text-sm text-ink-soft">Task and supplier safety limits still apply even when you have purchased AI credits.</p></div>
      <div className={card}><h3 className="text-xl font-semibold">Recent credit purchases</h3>{!data.topups.length ? <p className="mt-3 text-ink-soft">No completed credit purchases yet.</p> : <ul className="mt-3 divide-y divide-ink/10">{data.topups.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-3 py-3"><span>{when(item.createdAt)}</span><span>${(item.amountCents / 100).toFixed(2)} · {item.credits.toLocaleString()} credits{item.refundedCents > 0 && ` · $${(item.refundedCents / 100).toFixed(2)} refunded`}</span></li>)}</ul>}</div>
    </>}
  </section>;
}
