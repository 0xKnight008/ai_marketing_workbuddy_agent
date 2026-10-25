import {ActionReasonDialog} from '../admin/ActionReasonDialog';
import officialLogo from '../assets/piggybot-logo.png';
import '../workspace/workspace-b.css';
import {at,useAdminLocale,setAdminLocale} from '../admin/i18n';
import { useEffect, useRef, useState } from 'react';
import AdminEmailGate from '../components/AdminEmailGate';
import AdminAiCosts from '../components/AdminAiCosts';
import AdminTokenUsage from '../components/AdminTokenUsage';
const gatewayUrl = import.meta.env.VITE_GATEWAY_URL?.trim().replace(/\/+$/, '') || (import.meta.env.DEV ? 'http://localhost:4100' : '');
type AdminTab = 'workspaces' | 'feedback' | 'jobs' | 'referrals' | 'newsletter' | 'token-usage';
interface NewsletterView {
    id: string;
    email: string;
    createdAt: string;
    welcomeStatus: string;
    attempts: number;
    welcomeError: string | null;
    providerId: string | null;
    acceptedAt: string | null;
}
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
    taskId?:string|null;taskContext?:Record<string,unknown>|null;
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
    status: 'pending' | 'issuing' | 'available' | 'void' | 'reversal_pending' | 'clawed_back' | null;
}
const tabs: Array<{
    id: AdminTab;
    label: string;
}> = [
    { id: 'token-usage', label: 'Token usage' },
    { id: 'workspaces', label: 'Workspaces' },
    { id: 'feedback', label: 'Support tickets' },
    { id: 'newsletter', label: 'Newsletter subscribers' },
    { id: 'jobs', label: 'Dead-letter jobs' },
    { id: 'referrals', label: 'Referral ledger' },
];
export default function AdminDashboard() {useEffect(()=>{const meta=document.createElement('meta');meta.name='robots';meta.content='noindex, nofollow';document.head.appendChild(meta);return()=>meta.remove()},[]);const locale=useAdminLocale();useEffect(()=>{document.documentElement.lang=locale;},[locale]);return <div className="admin-b"><header className="admin-brand-bar"><a href="/"><img src={officialLogo} alt=""/>Piggybot ADMIN</a><label>{at('Language')} <select aria-label={at('Admin language')} value={locale} onChange={e=>setAdminLocale(e.target.value as 'zh'|'en')}><option value="zh">中文</option><option value="en">English</option></select></label></header><AdminEmailGate>{(email,logout,expired)=><AdminConsole email={email} logout={logout} expired={expired}/>}</AdminEmailGate></div>}
function AdminConsole({ email, logout, expired }: {
    email: string;
    logout: () => void;
    expired: () => void;
}) {
    // Internal console: reachable only by direct URL, never linked or indexed.
    useEffect(() => {
        document.title = 'Piggybot internal admin';
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex, nofollow';
        document.head.appendChild(meta);
        return () => { document.head.removeChild(meta); };
    }, []);
    const [menu,setMenu]=useState(false);const navRef=useRef<HTMLElement>(null);const menuRef=useRef<HTMLButtonElement>(null);const wasMenuOpen=useRef(false);
    useEffect(()=>{if(!menu){if(wasMenuOpen.current)menuRef.current?.focus();wasMenuOpen.current=false;return}wasMenuOpen.current=true;const old=document.body.style.overflow;document.body.style.overflow='hidden';const items=()=>Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>('button')??[]);items()[0]?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(false);return}const buttons=items();if(e.key==='Tab'&&buttons.length){if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1)?.focus()}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0]?.focus()}}};window.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;window.removeEventListener('keydown',key)}},[menu]);
    const [referralFilter,setReferralFilter]=useState('');
    const [tab, setTab] = useState<AdminTab>('token-usage');
    const [search, setSearch] = useState('');
    const [message, setMessage] = useState('Select a section or refresh to load records.');
    const [loading, setLoading] = useState(false);
    const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
    const [feedback, setFeedback] = useState<FeedbackView[]>([]);
    const [newsletter, setNewsletter] = useState<NewsletterView[]>([]);
    const [newsletterOffset, setNewsletterOffset] = useState(0);
    const [jobs, setJobs] = useState<JobView[]>([]);
    const [referrals, setReferrals] = useState<ReferralView[]>([]);
    const [referralOffset, setReferralOffset] = useState(0);
    const [plans, setPlans] = useState<Record<string, UsageView['plan']>>({});
    const [credits, setCredits] = useState<Record<string, string>>({});
    function headers(json = false): HeadersInit {
        return {
            ...(json ? { 'content-type': 'application/json' } : {}),
        };
    }
    async function request(path: string, init?: RequestInit): Promise<Response> {
        const response = await fetch(`${gatewayUrl}${path}`, { ...init, credentials: 'include', headers: { ...headers(Boolean(init?.body)), ...init?.headers } });
        if (response.status === 401)
            expired();
        return response;
    }
    async function load(nextTab: AdminTab = tab, offset = 0) {
        if (nextTab === 'token-usage')
            return;
        setLoading(true);
        setMessage('');
        try {
        const query = `?q=${encodeURIComponent(search.trim())}&offset=${offset}${nextTab==='referrals'&&referralFilter?'&status='+encodeURIComponent(referralFilter):''}`;
        const response = await request(`/api/admin/${nextTab}${query}`);
        const result = await response.json().catch(() => ({})) as unknown;
        setLoading(false);
        if (!response.ok) {
            const error = result as {
                error?: string;
            };
            setMessage(error.error === 'platform_admin_required' ? 'Admin access was denied.' : `Could not load ${nextTab}.`);
            return;
        }
        if (nextTab === 'workspaces') {
            const rows = result as WorkspaceView[];
            setWorkspaces(rows);
            setPlans(Object.fromEntries(rows.map((workspace) => [workspace.id, workspace.usage.plan])));
            setCredits(Object.fromEntries(rows.map((workspace) => [workspace.id, '0'])));
        }
        else if (nextTab === 'feedback')
            setFeedback(result as FeedbackView[]);
        else if (nextTab === 'newsletter') {
            setNewsletter(result as NewsletterView[]);
            setNewsletterOffset(offset);
        }
        else if (nextTab === 'jobs')
            setJobs(result as JobView[]);
        else {
            setReferrals(result as ReferralView[]);
            setReferralOffset(offset);
        }
        setMessage(at('Records loaded')+': '+(result as unknown[]).length);
        } catch {setMessage(at('Could not load records. Please retry.'))} finally {setLoading(false)}
    }
    const [pendingAction,setPendingAction]=useState<{path:string;body:Record<string,unknown>;success:string}|null>(null);
    const [actionError,setActionError]=useState('');
    async function mutate(path:string,body:Record<string,unknown>,success:string){setActionError('');setPendingAction({path,body,success});}
    async function performMutation(path: string, body: Record<string, unknown>, success: string) {
        setLoading(true);
        setMessage('');
        try {
        const response = await request(path, { method: path.includes('/feedback/') ? 'PATCH' : 'POST', body: JSON.stringify(body) });
        const result = await response.json().catch(() => ({})) as {error?:string;status?:string};
        setLoading(false);
        if (!response.ok) {
            setActionError(at('Action failed')+': '+(result.error??'unknown_error'));
            return;
        }
        setPendingAction(null);
        await load();
        setMessage(path.includes('/referrals/')?at('Request accepted; refresh to verify settlement.')+' ('+(result.status??'—')+')':success);
        }catch{setActionError(at('Request failed.'))}finally{setLoading(false)}
    }
    function selectTab(nextTab: AdminTab) {
        setTab(nextTab);
        void load(nextTab);
    }
    return (<div className="admin-console">{pendingAction&&<ActionReasonDialog action={pendingAction} busy={loading} error={actionError} onCancel={()=>setPendingAction(null)} onConfirm={reason=>void performMutation(pendingAction.path,{...pendingAction.body,reason},pendingAction.success)}/>}<button ref={menuRef} className="admin-mobile-nav rounded border p-3" aria-expanded={menu} aria-controls="admin-navigation" onClick={()=>setMenu(v=>!v)}>{at('Navigation')}</button>{menu&&<div className="admin-scrim" onClick={()=>setMenu(false)}/>}<nav ref={navRef} role="tablist" id="admin-navigation" className={`admin-nav ${menu?'open':''}`} aria-label={at('Admin sections')}>{tabs.map(item=><button role="tab" key={item.id} aria-selected={tab===item.id} onClick={()=>{setMenu(false);selectTab(item.id)}}>{at(item.label)}</button>)}</nav><main className="paper-grain min-h-screen bg-paper p-6 text-ink md:p-10">
      <header className="mx-auto flex max-w-7xl flex-col gap-4 border-b-2 border-ink/30 pb-6 md:flex-row md:items-end md:justify-between">
        <div><p className="font-hand text-xl text-sunset">{at("Piggybot Platform Admin")}</p><h1 className="font-display text-4xl">{at("Operations control room")}</h1></div>
        <div className="flex gap-4 text-sm"><a className="text-ink-soft hover:text-ink" href="/app">{at("Workspace console")}</a><a className="text-ink-soft hover:text-ink" href="/">{at("Back to site")}</a></div>
      </header>

      <section className="mx-auto mt-8 grid max-w-7xl gap-4 rounded-xl border border-ink/20 bg-paper-card p-5 lg:grid-cols-[1fr_1fr_auto]">
        <p className="text-sm">{at("Signed in as ")}{email}{at(". Session expires after 30 minutes.")}</p>
        <button onClick={logout} className="rounded border border-ink/20 px-4 py-2">{at("Sign out")}</button>
        {tab !== 'token-usage' && <button disabled={loading} onClick={() => void load()} className="rounded-md bg-sunset px-6 py-3 font-semibold text-white disabled:opacity-50">{loading ? at('Working…') : at('Refresh')}</button>}
      </section>

      <section className="mx-auto mt-6 max-w-7xl">
        {tab==='referrals'&&<label>{at('All referral states')}<select aria-label={at('All referral states')} value={referralFilter} onChange={e=>setReferralFilter(e.target.value)}><option value="">{at('All')}</option>{['pending','issuing','available','void','reversal_pending','clawed_back'].map(status=><option key={status} value={status}>{at(status)}</option>)}</select></label>}
        {tab !== 'token-usage' && <div className="mt-4 flex gap-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter')
            void load(); }} className="min-w-0 flex-1 rounded-md border border-ink/20 bg-paper-card p-3" placeholder={at("Search workspace, slug, owner, ticket, or email")}/>
          <button disabled={loading} onClick={() => void load()} className="rounded-md border border-ink/30 bg-paper-card px-5 py-3 font-medium disabled:opacity-50">{at("Search / refresh")}</button>
        </div>}
        {tab !== 'token-usage' && message && <p className="mt-3 text-sm text-sky-deep" role="status">{at(message)}</p>}
      </section>

      <section className="mx-auto mt-6 max-w-7xl overflow-x-auto rounded-xl border border-ink/20 bg-paper-card p-5">
        {tab === 'token-usage' && <><AdminTokenUsage request={request}/><AdminAiCosts request={request}/></>}
        {tab === 'newsletter' && <><p className="mb-4 text-sm">{at("Welcome status \u201Caccepted\u201D means Resend accepted the email, not confirmed inbox delivery. Check the provider ID in Resend for delivery or bounce details.")}</p><table className="w-full text-left text-sm"><thead><tr>{['Email', 'Subscribed', 'Welcome status', 'Attempts', 'Last error', 'Resend ID'].map(label => <th key={at(label)} className="p-3">{at(label)}</th>)}</tr></thead><tbody>{newsletter.map(row => <tr key={row.id} className="border-t border-ink/10"><td className="p-3">{row.email}</td><td className="p-3">{new Date(row.createdAt).toLocaleString()}</td><td className="p-3">{row.welcomeStatus}</td><td className="p-3">{row.attempts}</td><td className="p-3">{row.welcomeError ?? '—'}</td><td className="p-3">{row.providerId ?? '—'}</td></tr>)}</tbody></table>{!newsletter.length && <p>{at("No subscribers found.")}</p>}<div className="mt-4 flex gap-4"><button disabled={loading || newsletterOffset === 0} onClick={() => void load('newsletter', Math.max(0, newsletterOffset - 100))}>{at("Previous")}</button><span>{at("Page ")}{newsletterOffset / 100 + 1}</span><button disabled={loading || newsletter.length < 100} onClick={() => void load('newsletter', newsletterOffset + 100)}>{at("Next")}</button></div></>}
        {tab === 'workspaces' && <WorkspaceTable rows={workspaces} plans={plans} credits={credits} setPlans={setPlans} setCredits={setCredits} disabled={loading} update={(workspace) => mutate(`/api/admin/workspaces/${workspace.id}/entitlements`, entitlementChange(workspace, plans, credits), `Updated ${workspace.name}.`)}/>}
        {tab === 'feedback' && <FeedbackTable rows={feedback} disabled={loading} update={(ticket, status) => mutate(`/api/admin/feedback/${ticket.ticketNo}`, { status }, `${ticket.ticketNo} moved to ${status}.`)}/>}
        {tab === 'jobs' && <JobsTable rows={jobs} disabled={loading} replay={(job) => mutate(`/api/admin/jobs/${job.id}/replay`, { workspaceId: job.workspaceId }, `Requeued ${job.kind}.`)}/>}
        {tab === 'referrals' && <ReferralTable rows={referrals} disabled={loading} reverse={(entry) => mutate(`/api/admin/referrals/${entry.ledgerId}/void`, { workspaceId: entry.workspaceId }, `Referral credit ${entry.status === 'available' ? 'reversal queued' : 'voided'}.`)}/>}
        {tab === 'referrals' && <div className="mt-4 flex gap-4"><button disabled={loading || !referralOffset} onClick={() => void load('referrals', Math.max(0, referralOffset - 100))}>{at("Previous")}</button><span>{at("Page ")}{referralOffset / 100 + 1}</span><button disabled={loading || referrals.length < 100} onClick={() => void load('referrals', referralOffset + 100)}>{at("Next")}</button></div>}
      </section>
    </main></div>);
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
    if (!rows.length)
        return <Empty label="No matching workspaces."/>;
    return <table className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="border-b border-ink/20 text-xs uppercase tracking-wide text-ink-soft"><th className="p-3">{at("Workspace")}</th><th className="p-3">{at("Subscription")}</th><th className="p-3">{at("Usage / guardrail")}</th><th className="p-3">{at("Plan")}</th><th className="p-3">{at("Add credits")}</th><th className="p-3">{at("Action")}</th></tr></thead><tbody>{rows.map((workspace) => <tr key={workspace.id} className="border-b border-ink/10 align-top"><td className="p-3"><b>{workspace.name}</b><span className="block text-xs text-ink-soft">{workspace.slug}{at(" \u00B7 ")}{workspace.ownerEmail ?? 'No owner email'}</span></td><td className="p-3"><Status value={workspace.usage.subscriptionStatus}/></td><td className="p-3">{workspace.usage.taskUsed}{at("/")}{workspace.usage.taskQuota}{at(" tasks")}<span className="block text-xs text-ink-soft">{workspace.usage.aiCreditsAvailable}{at(" AI credits \u00B7 ")}{workspace.usage.status}</span></td><td className="p-3"><select value={plans[workspace.id] ?? workspace.usage.plan} onChange={(event) => setPlans((current) => ({ ...current, [workspace.id]: event.target.value as UsageView['plan'] }))} className="rounded border border-ink/20 bg-paper p-2"><option value="creator">{at("Creator")}</option><option value="growth">{at("Growth")}</option><option value="agency">{at("Agency")}</option></select></td><td className="p-3"><input type="number" min="0" step="1000" value={credits[workspace.id] ?? '0'} onChange={(event) => setCredits((current) => ({ ...current, [workspace.id]: event.target.value }))} className="w-28 rounded border border-ink/20 bg-paper p-2"/></td><td className="p-3"><button disabled={disabled || !validEntitlementChange(workspace, plans, credits)} onClick={() => void update(workspace)} className="rounded bg-sky-deep px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{at("Apply")}</button></td></tr>)}</tbody></table>;
}
function FeedbackTable({ rows, disabled, update }: {
    rows: FeedbackView[];
    disabled: boolean;
    update: (ticket: FeedbackView, status: FeedbackView['status']) => Promise<void>;
}) {
    if (!rows.length)
        return <Empty label="No matching support tickets."/>;
    return <table className="w-full min-w-[950px] text-left text-sm"><thead><tr className="border-b border-ink/20 text-xs uppercase tracking-wide text-ink-soft"><th className="p-3">{at("Ticket")}</th><th className="p-3">{at("Sender")}</th><th className="p-3">{at("Message")}</th><th className="p-3">{at("Status")}</th><th className="p-3">{at("Workflow")}</th></tr></thead><tbody>{rows.map((ticket) => <tr key={ticket.id} className="border-b border-ink/10 align-top"><td className="p-3"><b>{ticket.ticketNo}</b><span className="block text-xs text-ink-soft">{ticket.category}{at(" \u00B7 ")}{new Date(ticket.createdAt).toLocaleString()}</span></td><td className="p-3">{ticket.name ?? ticket.email}<span className="block text-xs text-ink-soft">{ticket.workspaceName ?? 'Public site'}</span></td><td className="max-w-md whitespace-pre-wrap p-3">{ticket.message}{ticket.taskId&&<details><summary>{at('Task context')}</summary><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(ticket.taskContext,null,2)}</pre></details>}</td><td className="p-3"><Status value={ticket.status}/></td><td className="p-3"><div className="flex gap-2">{ticket.status !== 'replied' && <button disabled={disabled} onClick={() => void update(ticket, 'replied')} className="rounded border border-ink/30 px-2 py-1 text-xs">{at("Mark replied")}</button>}{ticket.status !== 'closed' && <button disabled={disabled} onClick={() => void update(ticket, 'closed')} className="rounded bg-ink px-2 py-1 text-xs text-white">{at("Close")}</button>}{ticket.status === 'closed' && <button disabled={disabled} onClick={() => void update(ticket, 'new')} className="rounded border border-ink/30 px-2 py-1 text-xs">{at("Reopen")}</button>}</div></td></tr>)}</tbody></table>;
}
function JobsTable({ rows, disabled, replay }: {
    rows: JobView[];
    disabled: boolean;
    replay: (job: JobView) => Promise<void>;
}) {
    if (!rows.length)
        return <Empty label="No dead-letter jobs."/>;
    return <table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b border-ink/20 text-xs uppercase tracking-wide text-ink-soft"><th className="p-3">{at("Workspace")}</th><th className="p-3">{at("Job")}</th><th className="p-3">{at("Attempts")}</th><th className="p-3">{at("Last error")}</th><th className="p-3">{at("Action")}</th></tr></thead><tbody>{rows.map((job) => <tr key={job.id} className="border-b border-ink/10 align-top"><td className="p-3"><b>{job.workspaceName}</b><span className="block text-xs text-ink-soft">{job.workspaceId}</span></td><td className="p-3">{job.kind}<span className="block text-xs text-ink-soft">{job.runId ?? 'No workflow run'}{at(" \u00B7 ")}{new Date(job.updatedAt).toLocaleString()}</span></td><td className="p-3">{job.attempt}{at("/")}{job.maxAttempts}</td><td className="max-w-sm whitespace-pre-wrap p-3 text-xs">{job.lastError ?? 'No error recorded'}</td><td className="p-3"><button disabled={disabled||['issue_referral_credit','clawback_referral_credit'].includes(job.kind)} title={['issue_referral_credit','clawback_referral_credit'].includes(job.kind)?at('Financial jobs require reconciliation before replay.'):undefined} onClick={() => {void replay(job)}} className="rounded bg-sunset px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{at("Replay")}</button></td></tr>)}</tbody></table>;
}
function ReferralTable({ rows, disabled, reverse }: {
    rows: ReferralView[];
    disabled: boolean;
    reverse: (entry: ReferralView) => Promise<void>;
}) {
    if (!rows.length)
        return <Empty label="No referral attributions or credits."/>;
    return <table className="w-full min-w-[1000px] text-left text-sm"><thead><tr className="border-b border-ink/20 text-xs uppercase tracking-wide text-ink-soft"><th className="p-3">{at("Referrer")}</th><th className="p-3">{at("Referred workspace")}</th><th className="p-3">{at("Invoice")}</th><th className="p-3">{at("Credit")}</th><th className="p-3">{at("Status")}</th><th className="p-3">{at("Action")}</th></tr></thead><tbody>{rows.map((entry) => <tr key={`${entry.attributionId}:${entry.ledgerId ?? 'none'}`} className="border-b border-ink/10 align-top"><td className="p-3"><b>{entry.workspaceName}</b><span className="block text-xs text-ink-soft">{at("Code ")}{entry.referralCode}</span></td><td className="p-3">{entry.referredWorkspaceName}<span className="block text-xs text-ink-soft">{new Date(entry.attributedAt).toLocaleDateString()}</span></td><td className="p-3 text-xs">{entry.stripeInvoiceId ?? 'No paid invoice yet'}</td><td className="p-3">{formatCredit(entry)}</td><td className="p-3"><Status value={entry.status ?? 'attributed'}/></td><td className="p-3">{entry.ledgerId && (['pending','issuing','available'].includes(entry.status??'')) ? <button disabled={disabled} onClick={() => {void reverse(entry)}} className="rounded border border-sunset px-3 py-2 text-xs font-semibold text-sunset disabled:opacity-50">{entry.status === 'available' ? at('Request reversal') : entry.status==='issuing'?at('Record reversal request'):at('Request void')}</button> : <span className="text-xs text-ink-soft">{at("Read only")}</span>}</td></tr>)}</tbody></table>;
}
function formatCredit(entry: ReferralView): string {
    if (!entry.amountMicros)
        return '—';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (entry.currency ?? 'usd').toUpperCase() }).format(Number(entry.amountMicros) / 1000000);
}
function validEntitlementChange(workspace: WorkspaceView, plans: Record<string, UsageView['plan']>, credits: Record<string, string>): boolean {
    const credit = Number(credits[workspace.id] ?? 0);
    const planChanged = (plans[workspace.id] ?? workspace.usage.plan) !== workspace.usage.plan;
    return Number.isInteger(credit) && credit >= 0 && credit % 1000 === 0 && (planChanged || credit > 0);
}
function entitlementChange(workspace: WorkspaceView, plans: Record<string, UsageView['plan']>, credits: Record<string, string>): Record<string, unknown> {
    const selectedPlan = plans[workspace.id] ?? workspace.usage.plan;
    return {
        ...(selectedPlan === workspace.usage.plan ? {} : { plan: selectedPlan }),
        additionalAiCredits: Number(credits[workspace.id] ?? 0),
    };
}
function Status({ value }: {
    value: string;
}) {
    return <span className="inline-flex rounded-full bg-sky-pale px-2 py-1 text-xs font-semibold text-sky-deep">{at(value)}</span>;
}
function Empty({ label }: {
    label: string;
}) {
    return <p className="py-8 text-center text-sm text-ink-soft">{at(label)}</p>;
}
