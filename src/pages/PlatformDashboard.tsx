import { useEffect, useState, type ReactNode } from 'react';

import { clearSessionAccessToken, readSessionAccessToken, storeSessionAccessToken } from '../lib/auth-session';

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL?.trim().replace(/\/+$/, '') || (import.meta.env.DEV ? 'http://localhost:4100' : '');

/** Local paths only — never bounce to an external origin. */
function safeNextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '';
}

interface RunView { id: string; status: string; workflowId: string; createdAt: string; }
interface ApprovalView { id: string; runId: string; requestedAction: { summary?: string }; requestedAt: string; }
interface TaskEventView { id: string; runId: string; actionType: string; billableUnits: string; status: string; createdAt: string; }
interface AuditEventView { id: string; runId?: string; eventType: string; createdAt: string; }
interface UsageView { status: string; taskUsed: number; taskQuota: number; }
interface MeView {
  user: { email: string; displayName: string; passwordSet: boolean };
  workspace: { id: string; name: string };
  role: string;
  plan: string;
  subscriptionStatus: string;
}
interface SessionResponse { accessToken?: string; expiresAt?: string; }

const ACTIVE_SUBSCRIPTIONS = new Set(['active', 'trialing']);
const templates = [{ id: 'repurpose', name: 'Repurpose and schedule' }, { id: 'weekly_report', name: 'Weekly growth report' }, { id: 'comment_lead', name: 'Comment-to-lead review' }] as const;
const socialPlatforms = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'],
  ['pinterest', 'Pinterest'], ['googlebusiness', 'Google Business'], ['snapchat', 'Snapchat'],
  ['whatsapp', 'WhatsApp'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['twitter', 'X / Twitter'],
] as const;

export default function PlatformDashboard() {
  const [token, setToken] = useState(readSessionAccessToken);
  const [me, setMe] = useState<MeView | null>(null);
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [taskEvents] = useState<TaskEventView[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [message, setMessage] = useState('');
  const [connecting, setConnecting] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState('other');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [referralUrl, setReferralUrl] = useState('');
  const [referralStatus, setReferralStatus] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');

  function headers(): HeadersInit { return { authorization: `Bearer ${token}` }; }

  function signOut() {
    clearSessionAccessToken();
    setToken('');
    setMe(null);
  }

  async function loadMe(currentToken: string) {
    const response = await fetch(`${gatewayUrl}/api/auth/me`, { headers: { authorization: `Bearer ${currentToken}` } });
    if (response.status === 401 || response.status === 403) { signOut(); return; }
    if (response.ok) setMe(await response.json() as MeView);
  }

  // A stored session (from email sign-in or a one-time activation link) loads
  // the identity and workspace data as soon as the console opens.
  useEffect(() => {
    if (!token) return;
    void loadMe(token);
    void loadWorkspace();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadWorkspace() {
    setMessage('');
    const [approvalsResponse, usageResponse, auditResponse] = await Promise.all([
      fetch(`${gatewayUrl}/api/approval-requests`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/billing/task-events`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/audit-events`, { headers: headers() }),
    ]);
    if (approvalsResponse.ok) setApprovals(await approvalsResponse.json() as ApprovalView[]);
    if (usageResponse.ok) setUsage(await usageResponse.json() as UsageView);
    if (auditResponse.ok) setAuditEvents(await auditResponse.json() as AuditEventView[]);
    if (!approvalsResponse.ok && !usageResponse.ok && !auditResponse.ok) setMessage('The workspace data could not be loaded. Check your session permissions.');
  }

  async function loadRun() {
    setMessage('');
    const response = await fetch(`${gatewayUrl}/api/runs/${runId}`, { headers: headers() });
    if (!response.ok) { setRun(null); setMessage('Run not found or access is denied.'); return; }
    setRun(await response.json() as RunView);
  }

  async function publishTemplate(templateId: typeof templates[number]['id']) {
    setMessage('');
    const response = await fetch(`${gatewayUrl}/api/workflow-templates/${templateId}/publish`, { method: 'POST', headers: headers() });
    if (!response.ok) { setMessage('Template publishing needs an editor or administrator session.'); return; }
    const workflow = await response.json() as { workflowId: string; name: string };
    setMessage(`${workflow.name} is published. Create a run with workflow ${workflow.workflowId}.`);
    await loadWorkspace();
  }

  async function connectSocial(platform: typeof socialPlatforms[number][0]) {
    setMessage(''); setConnecting(platform);
    const response = await fetch(`${gatewayUrl}/api/zernio/connect?platform=${encodeURIComponent(platform)}`, { headers: headers() });
    const result = await response.json().catch(() => ({})) as { url?: string };
    setConnecting('');
    if (!response.ok || !result.url) { setMessage('The connection could not be started. Check your session and connector configuration.'); return; }
    window.open(result.url, 'piggybot-zernio-connect', 'popup,width=720,height=820');
  }

  async function decideApproval(approvalId: string, decision: 'approved' | 'rejected') {
    const response = await fetch(`${gatewayUrl}/api/approval-requests/${approvalId}/${decision}`, { method: 'POST', headers: headers() });
    setMessage(response.ok ? `Approval ${decision}.` : 'The approval decision could not be saved.');
    if (response.ok) await loadWorkspace();
  }

  async function sendFeedback() {
    setFeedbackStatus('');
    const response = await fetch(`${gatewayUrl}/api/feedback`, {
      method: 'POST', headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ category: feedbackCategory, message: feedbackMessage, locale: document.documentElement.lang.slice(0, 2), pageUrl: window.location.href }),
    });
    const result = await response.json().catch(() => ({})) as { ticketId?: string };
    if (!response.ok || !result.ticketId) { setFeedbackStatus('Your message could not be sent. Confirm that your workspace session is active.'); return; }
    setFeedbackMessage('');
    setFeedbackStatus(`Thanks — ticket ${result.ticketId} was sent to support.`);
  }

  async function createReferralLink() {
    const response = await fetch(`${gatewayUrl}/api/referral/link`, { method: 'POST', headers: headers() });
    const result = await response.json().catch(() => ({})) as { url?: string };
    if (!response.ok || !result.url) { setReferralStatus('A workspace owner or admin session is required.'); return; }
    setReferralUrl(result.url); setReferralStatus('Share this link and earn 20% credit on eligible first-year payments.');
  }

  async function savePassword() {
    setPasswordStatus('');
    const response = await fetch(`${gatewayUrl}/api/auth/password`, {
      method: 'POST', headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    if (!response.ok) { setPasswordStatus('The password could not be saved. Use 8-128 characters.'); return; }
    setNewPassword('');
    setPasswordStatus('Password saved — you can now sign in with your email.');
    await loadMe(token);
  }

  if (!token) {
    return <EmailAuthScreen onSession={(session) => {
      storeSessionAccessToken(session);
      const next = safeNextPath();
      if (next) { window.location.assign(next); return; }
      setToken(session);
    }} />;
  }

  // Already signed in and arrived here only to bounce onwards (e.g. checkout).
  const next = safeNextPath();
  if (next && window.location.pathname.startsWith('/app') && !window.location.pathname.startsWith('/app/admin')) {
    window.location.assign(next);
    return null;
  }

  const locked = me ? !ACTIVE_SUBSCRIPTIONS.has(me.subscriptionStatus) : false;

  return (
    <main className="paper-grain min-h-screen bg-paper text-ink p-6 md:p-10">
      <header className="mx-auto max-w-6xl flex flex-col gap-4 border-b-2 border-ink/30 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-hand text-xl text-sky-deep">Piggybot Platform</p>
          <h1 className="font-display text-4xl">{me?.workspace.name ?? 'Workflow operations'}</h1>
          {me && <p className="mt-1 text-sm text-ink-soft">Signed in as {me.user.email} · {me.role} · plan {me.plan}</p>}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a className="text-ink-soft hover:text-ink" href="/contact">Help</a>
          <a className="text-ink-soft hover:text-ink" href="/">Back to site</a>
          <button onClick={signOut} className="rounded-md border border-ink/20 px-3 py-1.5 text-ink-soft hover:text-ink">Sign out</button>
        </div>
      </header>

      {locked && (
        <section className="mx-auto mt-8 max-w-6xl rounded-xl border-2 border-sunset/50 bg-sunset/10 p-5">
          <h2 className="text-lg font-semibold">Your workspace is in preview mode</h2>
          <p className="mt-1 text-sm text-ink-soft">Every feature is locked until this workspace has an active subscription. Choose a plan to unlock publishing, connectors, referrals, and support.</p>
          <a href="/activate?plan=growth" className="mt-4 inline-block rounded-md bg-sunset px-5 py-3 font-medium text-white shadow-paint-sm transition hover:-translate-y-0.5">Subscribe to unlock</a>
        </section>
      )}

      <div className={locked ? 'pointer-events-none select-none opacity-40 grayscale' : ''} aria-disabled={locked}>
        <section className="mx-auto grid max-w-6xl gap-6 py-8 lg:grid-cols-3">
          <div className="wobble sketch shadow-paint bg-paper-card p-5 lg:col-span-2">
            <h2 className="text-lg font-semibold">Start from a template</h2>
            <p className="mt-1 text-sm text-slate-500">Templates become versioned workflows when an editor publishes them.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {templates.map(({ id, name }) => (
                <button key={id} disabled={locked} className="wobble-2 sketch bg-sky-pale p-4 text-left shadow-paint-sm transition hover:-translate-y-1 hover:bg-sun/40 disabled:cursor-not-allowed" onClick={() => void publishTemplate(id)}>
                  <span className="block font-medium">{name}</span><span className="mt-2 block text-xs text-slate-500">Approval-first</span>
                </button>
              ))}
            </div>
          </div>
          <div className="wobble sketch bg-paper-card p-5">
            <h2 className="text-lg font-semibold">Account</h2>
            {me && <p className="mt-2 text-sm text-ink-soft">{me.user.email}</p>}
            {me && !me.user.passwordSet && (
              <>
                <p className="mt-3 text-sm text-ink-soft">Set a password so you can sign in with your email next time.</p>
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-2 text-xs" placeholder="New password (8-128 characters)" autoComplete="new-password" />
                <button disabled={newPassword.length < 8} onClick={() => void savePassword()} className="mt-3 w-full rounded-md bg-sky-deep px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">Save password</button>
              </>
            )}
            {passwordStatus && <p className="mt-3 text-sm text-sky-deep" role="status">{passwordStatus}</p>}
            <button onClick={() => void loadWorkspace()} className="mt-3 w-full rounded-md border border-ink/20 px-4 py-2 text-sm font-medium text-ink-soft">Refresh workspace</button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl rounded-xl border border-ink/20 bg-paper-card p-5">
          <h2 className="text-lg font-semibold">Connected social accounts</h2>
          <p className="mt-1 text-sm text-ink-soft">Connect inside Piggybot. If a network offers several pages, organizations, boards, locations, profiles, or phone numbers, you will choose one in a Piggybot window.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {socialPlatforms.map(([id, label]) => <button key={id} disabled={!token || locked || Boolean(connecting)} onClick={() => void connectSocial(id)} className="rounded-md border border-ink/30 bg-paper px-4 py-2 text-sm font-medium hover:bg-sky-pale disabled:cursor-not-allowed disabled:opacity-50">{connecting === id ? 'Opening…' : `Connect ${label}`}</button>)}
          </div>
        </section>

        <section className="mx-auto max-w-6xl rounded-xl border border-ink/20 bg-paper-card p-5">
          <h2 className="text-lg font-semibold">Help & support</h2>
          <p className="mt-1 text-sm text-ink-soft">Send a message with this workspace automatically attached. We reply within one business day.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]">
            <select value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value)} className="rounded-md border border-ink/20 bg-paper p-3"><option value="billing">Billing</option><option value="bug">Bug</option><option value="feature">Feature request</option><option value="other">Other</option></select>
            <textarea value={feedbackMessage} maxLength={2000} onChange={(event) => setFeedbackMessage(event.target.value)} className="min-h-24 rounded-md border border-ink/20 bg-paper p-3" placeholder="How can we help?" />
            <button disabled={!token || locked || !feedbackMessage.trim()} onClick={() => void sendFeedback()} className="h-fit rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">Send to support</button>
          </div>
          {feedbackStatus && <p className="mt-3 text-sm text-sky-deep" role="status">{feedbackStatus}</p>}
        </section>

        {usage?.status === 'degraded' && <section className="mx-auto max-w-6xl rounded-xl border border-sun/50 bg-sun/20 p-5 text-sm text-ink"><b>Energy-saving mode is on.</b> This month’s task quota is used, so new AI runs use the Eco model until your next billing period. Publishing and existing work remain available.</section>}

        <section className="mx-auto max-w-6xl rounded-xl border border-ink/20 bg-paper-card p-5">
          <h2 className="text-lg font-semibold">Refer & earn 20%</h2>
          <p className="mt-1 text-sm text-ink-soft">Earn account credit after your referral’s paid subscription clears its 30-day refund window.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row"><input readOnly value={referralUrl} className="flex-1 rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder="Generate your personal referral link" /><button onClick={() => void createReferralLink()} disabled={!token || locked} className="rounded-md bg-sunset px-5 py-3 font-medium text-white disabled:opacity-50">Generate link</button>{referralUrl && <button onClick={() => void navigator.clipboard.writeText(referralUrl)} className="rounded-md border border-ink/30 px-5 py-3 font-medium">Copy</button>}</div>
          {referralStatus && <p className="mt-3 text-sm text-sky-deep" role="status">{referralStatus}</p>}
        </section>

        <section className="mx-auto max-w-6xl rounded-xl border border-ink/20 bg-paper-card p-5">
          <h2 className="text-lg font-semibold">Run timeline</h2>
          <div className="mt-4 flex flex-col gap-3 md:flex-row"><input value={runId} onChange={(event) => setRunId(event.target.value)} className="flex-1 rounded-md border border-ink/20 bg-paper p-3" placeholder="Workflow run UUID" /><button onClick={() => void loadRun()} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white">Load run</button></div>
          {message && <p className="mt-4 text-sm text-sky-deep">{message}</p>}
          {run && <div className="mt-5 grid gap-3 rounded-lg bg-sky-pale p-4 text-sm md:grid-cols-3"><span>Status: <b>{run.status}</b></span><span>Workflow: {run.workflowId}</span><span>Created: {new Date(run.createdAt).toLocaleString()}</span></div>}
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 py-8 lg:grid-cols-3">
          <Feed title="Approvals" empty="No actions are waiting for approval.">{approvals.map((approval) => <div key={approval.id} className="border-b border-ink/10 py-3 text-sm"><p>{approval.requestedAction.summary ?? 'Publishing action'}</p><p className="mt-1 text-xs text-ink-soft">{new Date(approval.requestedAt).toLocaleString()}</p><div className="mt-2 flex gap-2"><button className="rounded bg-sky-deep px-2 py-1 text-xs text-white" onClick={() => void decideApproval(approval.id, 'approved')}>Approve</button><button className="rounded border border-ink/30 px-2 py-1 text-xs" onClick={() => void decideApproval(approval.id, 'rejected')}>Reject</button></div></div>)}</Feed>
          <Feed title="Usage" empty="No billable actions yet.">{taskEvents.map((event) => <div key={event.id} className="border-b border-ink/10 py-3 text-sm"><p>{event.actionType}: {event.billableUnits} unit(s)</p><p className="mt-1 text-xs text-ink-soft">{event.status} · {new Date(event.createdAt).toLocaleString()}</p></div>)}</Feed>
          <Feed title="Audit trail" empty="No audit events yet.">{auditEvents.map((event) => <div key={event.id} className="border-b border-ink/10 py-3 text-sm"><p>{event.eventType}</p><p className="mt-1 text-xs text-ink-soft">{new Date(event.createdAt).toLocaleString()}</p></div>)}</Feed>
        </section>
      </div>
    </main>
  );
}

/** Email sign-in / registration gate shown when the console has no session. */
function EmailAuthScreen({ onSession }: { onSession: (accessToken: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${gatewayUrl}/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'login'
          ? { email, password }
          : { email, password, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) }),
      });
      const body = await response.json().catch(() => ({})) as SessionResponse & { error?: string };
      if (!response.ok || typeof body.accessToken !== 'string') {
        setError(body.error === 'email_already_registered'
          ? 'This email already has an account — sign in instead.'
          : body.error === 'rate_limited'
            ? 'Too many attempts. Wait a few minutes and try again.'
            : 'Sign-in failed. Check your email and password.');
        return;
      }
      onSession(body.accessToken);
    } catch {
      setError('The platform could not be reached. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="paper-grain flex min-h-screen items-center justify-center bg-paper p-6 text-ink">
      <section className="wobble sketch w-full max-w-md bg-paper-card p-8 shadow-paint">
        <p className="font-hand text-xl text-sky-deep">Piggybot Platform</p>
        <h1 className="mt-2 font-display text-3xl">{mode === 'login' ? 'Sign in to your workspace' : 'Create your workspace'}</h1>
        <p className="mt-2 text-sm text-ink-soft">{mode === 'login' ? 'Use the email you signed up with — Gmail works great.' : 'Register with your email. A free workspace is created instantly; subscribe any time to unlock every feature.'}</p>

        <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-ink/15 p-1 text-sm font-medium">
          <button onClick={() => { setMode('login'); setError(''); }} className={`rounded-md px-3 py-2 ${mode === 'login' ? 'bg-sky-deep text-white' : 'text-ink-soft hover:text-ink'}`}>Sign in</button>
          <button onClick={() => { setMode('register'); setError(''); }} className={`rounded-md px-3 py-2 ${mode === 'register' ? 'bg-sky-deep text-white' : 'text-ink-soft hover:text-ink'}`}>Register</button>
        </div>

        <label className="mt-5 block text-sm text-ink-soft">Email</label>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder="you@gmail.com" autoComplete="email" />
        <label className="mt-4 block text-sm text-ink-soft">Password</label>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder={mode === 'register' ? '8-128 characters' : 'Your password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {mode === 'register' && <>
          <label className="mt-4 block text-sm text-ink-soft">Display name <span className="text-ink-faint">(optional)</span></label>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder="How should we call you?" autoComplete="name" />
        </>}

        {error && <p className="mt-4 rounded-lg bg-sunset/15 p-3 text-sm text-sunset-deep" role="alert">{error}</p>}
        <button disabled={busy || !email.trim() || password.length < 8} onClick={() => void submit()} className="mt-6 w-full rounded-md bg-sky-deep px-4 py-3 font-medium text-white shadow-paint-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <div className="mt-5 flex justify-between text-sm">
          <a href="/" className="text-ink-soft hover:text-ink">← Back to site</a>
          <a href="/contact" className="text-ink-soft hover:text-ink">Need help?</a>
        </div>
      </section>
    </main>
  );
}

function Feed({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return <section className="wobble sketch bg-paper-card p-5"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-3">{children || <p className="text-sm text-ink-soft">{empty}</p>}</div></section>;
}
