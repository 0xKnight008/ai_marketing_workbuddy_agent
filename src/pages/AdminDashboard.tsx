import { useEffect, useState } from 'react';

import { readSessionAccessToken } from '../lib/auth-session';

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL?.trim().replace(/\/+$/, '') || (import.meta.env.DEV ? 'http://localhost:4100' : '');
type AdminTab = 'workspaces' | 'feedback' | 'jobs' | 'referrals';

interface UsageView {
  plan: 'creator' | 'growth' | 'agency';
  taskUsed: number;
  taskQuota: number;
  aiCreditsUsed: number;
  aiCreditsAvailable: number;
  status: string;
  subscriptionStatus: string;
}

interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: string;
  usage: UsageView;
}

interface FeedbackView {
  id: string;
  ticketNo: string;
  workspaceId: string | null;
  workspaceName: string | null;
  email: string;
  name: string | null;
  category: string;
  message: string;
  status: 'new' | 'replied' | 'closed';
  createdAt: string;
}

interface JobView {
  id: string;
  workspaceId: string;
  workspaceName: string;
  runId: string | null;
  kind: string;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string;
}

interface ReferralView {
  attributionId: string;
  workspaceId: string;
  workspaceName: string;
  referralCode: string;
  referredWorkspaceId: string;
  referredWorkspaceName: string;
  attributedAt: string;
  ledgerId: string | null;
  stripeInvoiceId: string | null;
  amountMicros: string | null;
  currency: string | null;
  status: 'pending' | 'available' | 'void' | 'clawed_back' | null;
}

const tabs: Array<{ id: AdminTab; label: string }> = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'feedback', label: 'Support tickets' },
  { id: 'jobs', label: 'Dead-letter jobs' },
  { id: 'referrals', label: 'Referral ledger' },
];

export default function AdminDashboard() {
  // Internal console: reachable only by direct URL, never linked or indexed.
  useEffect(() => {
    document.title = 'Piggybot internal admin';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  const [accessToken, setAccessToken] = useState(readSessionAccessToken);
  const [adminToken, setAdminToken] = useState('');
  const [tab, setTab] = useState<AdminTab>('workspaces');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('Enter both credentials to unlock the platform admin console.');
  const [loading, setLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [feedback, setFeedback] = useState<FeedbackView[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [referrals, setReferrals] = useState<ReferralView[]>([]);
  const [plans, setPlans] = useState<Record<string, UsageView['plan']>>({});
  const [credits, setCredits] = useState<Record<string, string>>({});

  function headers(json = false): HeadersInit {
    return {
      authorization: `Bearer ${accessToken}`,
      'x-billing-admin-token': adminToken,
      ...(json ? { 'content-type': 'application/json' } : {}),
    };
  }

  async function request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${gatewayUrl}${path}`, { ...init, headers: { ...headers(Boolean(init?.body)), ...init?.headers } });
  }

  async function load(nextTab: AdminTab = tab) {
    if (!accessToken.trim() || !adminToken.trim()) {
      setMessage('Both the owner/admin session and platform admin secret are required.');
      return;
    }
    setLoading(true);
    setMessage('');
    const query = `?q=${encodeURIComponent(search.trim())}`;
    const response = await request(`/api/admin/${nextTab}${query}`);
    const result = await response.json().catch(() => ({})) as unknown;
    setLoading(false);
    if (!response.ok) {
      const error = result as { error?: string };
      setMessage(error.error === 'platform_admin_required' ? 'Admin access was denied. Check both credentials.' : `Could not load ${nextTab}.`);
      return;
    }
    if (nextTab === 'workspaces') {
      const rows = result as WorkspaceView[];
      setWorkspaces(rows);
      setPlans(Object.fromEntries(rows.map((workspace) => [workspace.id, workspace.usage.plan])));
      setCredits(Object.fromEntries(rows.map((workspace) => [workspace.id, '0'])));
    } else if (nextTab === 'feedback') setFeedback(result as FeedbackView[]);
    else if (nextTab === 'jobs') setJobs(result as JobView[]);
    else setReferrals(result as ReferralView[]);
    setMessage(`${(result as unknown[]).length} ${nextTab} record(s) loaded.`);
  }

  async function mutate(path: string, body: Record<string, unknown>, success: string) {
    setLoading(true);
    setMessage('');
    const response = await request(path, { method: path.includes('/feedback/') ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setLoading(false);
    if (!response.ok) {
      setMessage(`Action failed: ${result.error ?? 'unknown_error'}.`);
      return;
    }
    setMessage(success);
    await load();
  }

  function selectTab(nextTab: AdminTab) {
    setTab(nextTab);
    void load(nextTab);
  }

  return (
    <main className="paper-grain min-h-screen bg-paper p-6 text-ink md:p-10">
      <header className="mx-auto flex max-w-7xl flex-col gap-4 border-b-2 border-ink/30 pb-6 md:flex-row md:items-end md:justify-between">
        <div><p className="font-hand text-xl text-sunset">Piggybot Platform Admin</p><h1 className="font-display text-4xl">Operations control room</h1></div>
        <div className="flex gap-4 text-sm"><a className="text-ink-soft hover:text-ink" href="/app">Workspace console</a><a className="text-ink-soft hover:text-ink" href="/">Back to site</a></div>
      </header>

      <section className="mx-auto mt-8 grid max-w-7xl gap-4 rounded-xl border border-ink/20 bg-paper-card p-5 lg:grid-cols-[1fr_1fr_auto]">
        <label className="text-sm text-ink-soft">Owner/admin access token
          <input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-xs text-ink" placeholder="Short-lived signed session" />
        </label>
        <label className="text-sm text-ink-soft">Platform admin secret
          <input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-xs text-ink" placeholder="Never stored in the browser" />
        </label>
        <button disabled={loading} onClick={() => void load()} className="h-fit self-end rounded-md bg-sunset px-6 py-3 font-semibold text-white disabled:opacity-50">{loading ? 'Working…' : 'Unlock'}</button>
        <p className="text-xs text-ink-soft lg:col-span-3">Both factors are required for every request. The admin secret remains only in this page’s memory and is cleared when the tab closes.</p>
      </section>

      <section className="mx-auto mt-6 max-w-7xl">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
          {tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => selectTab(item.id)} className={`rounded-md px-4 py-2 text-sm font-semibold ${tab === item.id ? 'bg-sky-deep text-white' : 'border border-ink/20 bg-paper-card text-ink'}`}>{item.label}</button>)}
        </div>
        <div className="mt-4 flex gap-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} className="min-w-0 flex-1 rounded-md border border-ink/20 bg-paper-card p-3" placeholder="Search workspace, slug, owner, ticket, or email" />
          <button disabled={loading} onClick={() => void load()} className="rounded-md border border-ink/30 bg-paper-card px-5 py-3 font-medium disabled:opacity-50">Search / refresh</button>
        </div>
        {message && <p className="mt-3 text-sm text-sky-deep" role="status">{message}</p>}
      </section>

      <section className="mx-auto mt-6 max-w-7xl overflow-x-auto rounded-xl border border-ink/20 bg-paper-card p-5">
        {tab === 'workspaces' && <WorkspaceTable rows={workspaces} plans={plans} credits={credits} setPlans={setPlans} setCredits={setCredits} disabled={loading} update={(workspace) => mutate(`/api/admin/workspaces/${workspace.id}/entitlements`, entitlementChange(workspace, plans, credits), `Updated ${workspace.name}.`)} />}
        {tab === 'feedback' && <FeedbackTable rows={feedback} disabled={loading} update={(ticket, status) => mutate(`/api/admin/feedback/${ticket.ticketNo}`, { status }, `${ticket.ticketNo} moved to ${status}.`)} />}
        {tab === 'jobs' && <JobsTable rows={jobs} disabled={loading} replay={(job) => mutate(`/api/admin/jobs/${job.id}/replay`, { workspaceId: job.workspaceId }, `Requeued ${job.kind}.`)} />}
        {tab === 'referrals' && <ReferralTable rows={referrals} disabled={loading} reverse={(entry) => mutate(`/api/admin/referrals/${entry.ledgerId}/void`, { workspaceId: entry.workspaceId }, `Referral credit ${entry.status === 'available' ? 'reversal queued' : 'voided'}.`)} />}
      </section>
    </main>
  );
}

function WorkspaceTable({ rows, plans, credits, setPlans, setCredits, disabled, update }: {
  rows: WorkspaceView[];
  plans: Record<string, UsageView['plan']>;
  credits: Record<string, string>;
  setPlans: React.Dispatch<React.SetStateAction<Record<string, UsageView['plan']>>>;
  setCredits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  disabled: boolean;
  update: (workspace: WorkspaceView) => Promise<void>;
}) {
  if (!rows.length) return <Empty label="No matching workspaces." />;
  return <table className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="border-b border-ink/20 text-xs uppercase tracking-wide text-ink-soft"><th className="p-3">Workspace</th><th className="p-3">Subscription</th><th className="p-3">Usage / guardrail</th><th className="p-3">Plan</th><th className="p-3">Add credits</th><th className="p-3">Action</th></tr></thead><tbody>{rows.map((workspace) => <tr key={workspace.id} className="border-b border-ink/10 align-top"><td className="p-3"><b>{workspace.name}</b><span className="block text-xs text-ink-soft">{workspace.slug} · {workspace.ownerEmail ?? 'No owner email'}</span></td><td className="p-3"><Status value={workspace.usage.subscriptionStatus} /></td><td className="p-3">{workspace.usage.taskUsed}/{workspace.usage.taskQuota} tasks<span className="block text-xs text-ink-soft">{workspace.usage.aiCreditsAvailable} AI credits · {workspace.usage.status}</span></td><td className="p-3"><select value={plans[workspace.id] ?? workspace.usage.plan} onChange={(event) => setPlans((current) => ({ ...current, [workspace.id]: event.target.value as UsageView['plan'] }))} className="rounded border border-ink/20 bg-paper p-2"><option value="creator">Creator</option><option value="growth">Growth</option><option value="agency">Agency</option></select></td><td className="p-3"><input type="number" min="0" step="1000" value={credits[workspace.id] ?? '0'} onChange={(event) => setCredits((current) => ({ ...current, [workspace.id]: event.target.value }))} className="w-28 rounded border border-ink/20 bg-paper p-2" /></td><td className="p-3"><button disabled={disabled || !validEntitlementChange(workspace, plans, credits)} onClick={() => void update(workspace)} className="rounded bg-sky-deep px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Apply</button></td></tr>)}</tbody></table>;
}

function FeedbackTable({ rows, disabled, update }: { rows: FeedbackView[]; disabled: boolean; update: (ticket: FeedbackView, status: FeedbackView['status']) => Promise<void> }) {
  if (!rows.length) return <Empty label="No matching support tickets." />;
  return <table className="w-full min-w-[950px] text-left text-sm"><thead><tr className="border-b border-ink/20 text-xs uppercase tracking-wide text-ink-soft"><th className="p-3">Ticket</th><th className="p-3">Sender</th><th className="p-3">Message</th><th className="p-3">Status</th><th className="p-3">Workflow</th></tr></thead><tbody>{rows.map((ticket) => <tr key={ticket.id} className="border-b border-ink/10 align-top"><td className="p-3"><b>{ticket.ticketNo}</b><span className="block text-xs text-ink-soft">{ticket.category} · {new Date(ticket.createdAt).toLocaleString()}</span></td><td className="p-3">{ticket.name ?? ticket.email}<span className="block text-xs text-ink-soft">{ticket.workspaceName ?? 'Public site'}</span></td><td className="max-w-md whitespace-pre-wrap p-3">{ticket.message}</td><td className="p-3"><Status value={ticket.status} /></td><td className="p-3"><div className="flex gap-2">{ticket.status !== 'replied' && <button disabled={disabled} onClick={() => void update(ticket, 'replied')} className="rounded border border-ink/30 px-2 py-1 text-xs">Mark replied</button>}{ticket.status !== 'closed' && <button disabled={disabled} onClick={() => void update(ticket, 'closed')} className="rounded bg-ink px-2 py-1 text-xs text-white">Close</button>}{ticket.status === 'closed' && <button disabled={disabled} onClick={() => void update(ticket, 'new')} className="rounded border border-ink/30 px-2 py-1 text-xs">Reopen</button>}</div></td></tr>)}</tbody></table>;
}

function JobsTable({ rows, disabled, replay }: { rows: JobView[]; disabled: boolean; replay: (job: JobView) => Promise<void> }) {
  if (!rows.length) return <Empty label="No dead-letter jobs." />;
  return <table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-ink/20 text-xs uppercase tracking-wide text-ink-soft"><th className="p-3">Workspace</th><th className="p-3">Job</th><th className="p-3">Attempts</th><th className="p-3">Last error</th><th className="p-3">Action</th></tr></thead><tbody>{rows.map((job) => <tr key={job.id} className="border-b border-ink/10 align-top"><td className="p-3"><b>{job.workspaceName}</b><span className="block text-xs text-ink-soft">{job.workspaceId}</span></td><td className="p-3">{job.kind}<span className="block text-xs text-ink-soft">{job.runId ?? 'No workflow run'} · {new Date(job.updatedAt).toLocaleString()}</span></td><td className="p-3">{job.attempt}/{job.maxAttempts}</td><td className="max-w-sm whitespace-pre-wrap p-3 text-xs">{job.lastError ?? 'No error recorded'}</td><td className="p-3"><button disabled={disabled} onClick={() => void replay(job)} className="rounded bg-sunset px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Replay</button></td></tr>)}</tbody></table>;
}

function ReferralTable({ rows, disabled, reverse }: { rows: ReferralView[]; disabled: boolean; reverse: (entry: ReferralView) => Promise<void> }) {
  if (!rows.length) return <Empty label="No referral attributions or credits." />;
  return <table className="w-full min-w-[1000px] text-left text-sm"><thead><tr className="border-b border-ink/20 text-xs uppercase tracking-wide text-ink-soft"><th className="p-3">Referrer</th><th className="p-3">Referred workspace</th><th className="p-3">Invoice</th><th className="p-3">Credit</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody>{rows.map((entry) => <tr key={`${entry.attributionId}:${entry.ledgerId ?? 'none'}`} className="border-b border-ink/10 align-top"><td className="p-3"><b>{entry.workspaceName}</b><span className="block text-xs text-ink-soft">Code {entry.referralCode}</span></td><td className="p-3">{entry.referredWorkspaceName}<span className="block text-xs text-ink-soft">{new Date(entry.attributedAt).toLocaleDateString()}</span></td><td className="p-3 text-xs">{entry.stripeInvoiceId ?? 'No paid invoice yet'}</td><td className="p-3">{formatCredit(entry)}</td><td className="p-3"><Status value={entry.status ?? 'attributed'} /></td><td className="p-3">{entry.ledgerId && (entry.status === 'pending' || entry.status === 'available') ? <button disabled={disabled} onClick={() => void reverse(entry)} className="rounded border border-sunset px-3 py-2 text-xs font-semibold text-sunset disabled:opacity-50">{entry.status === 'available' ? 'Reverse' : 'Void'}</button> : <span className="text-xs text-ink-soft">Read only</span>}</td></tr>)}</tbody></table>;
}

function formatCredit(entry: ReferralView): string {
  if (!entry.amountMicros) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: (entry.currency ?? 'usd').toUpperCase() }).format(Number(entry.amountMicros) / 1_000_000);
}

function validEntitlementChange(workspace: WorkspaceView, plans: Record<string, UsageView['plan']>, credits: Record<string, string>): boolean {
  const credit = Number(credits[workspace.id] ?? 0);
  const planChanged = (plans[workspace.id] ?? workspace.usage.plan) !== workspace.usage.plan;
  return Number.isInteger(credit) && credit >= 0 && credit % 1_000 === 0 && (planChanged || credit > 0);
}

function entitlementChange(workspace: WorkspaceView, plans: Record<string, UsageView['plan']>, credits: Record<string, string>): Record<string, unknown> {
  const selectedPlan = plans[workspace.id] ?? workspace.usage.plan;
  return {
    ...(selectedPlan === workspace.usage.plan ? {} : { plan: selectedPlan }),
    additionalAiCredits: Number(credits[workspace.id] ?? 0),
  };
}

function Status({ value }: { value: string }) {
  return <span className="inline-flex rounded-full bg-sky-pale px-2 py-1 text-xs font-semibold text-sky-deep">{value.replaceAll('_', ' ')}</span>;
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-ink-soft">{label}</p>;
}
