import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearSessionAccessToken, readSessionAccessToken } from '../lib/auth-session';

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:4100';

type Section = 'pipelines' | 'accounts' | 'activity' | 'settings';
type WizardStep = 'start' | 'configure' | 'accounts' | 'review' | 'saved';
type TemplateId = 'repurpose' | 'weekly_report' | 'comment_lead';

interface PipelineTemplate { id: TemplateId; name: string; description: string; steps: string[]; }
interface PipelineDefinition {
  source: { type: 'template'; templateId: TemplateId } | { type: 'description'; description: string };
  brief: string;
  targetAccountIds: string[];
  approvalPolicy: 'required' | 'auto_approve';
  tone: string;
  language: string;
  steps: Array<{ type: string }>;
}
interface PipelineView { id: string; name: string; status: 'draft' | 'published' | 'archived'; version: number; updatedAt: string; definition: PipelineDefinition; lastRunStatus?: string; }
interface ConnectedAccount { id: string; externalAccountId: string; displayName: string; platform: string; capabilities: string[]; status: 'connected' | 'expired' | 'disconnected' | 'syncing'; lastSyncedAt?: string; }
interface PipelineCheck { id: string; label: string; passed: boolean; detail: string; }
interface PipelineReadiness { ready: boolean; checks: PipelineCheck[]; }
interface RunView { id: string; status: string; workflowId: string; createdAt: string; }
interface ApprovalView { id: string; runId: string; requestedAction: { summary?: string }; requestedAt: string; }
interface TaskEventView { id: string; runId: string; actionType: string; billableUnits: string; status: string; createdAt: string; }
interface AuditEventView { id: string; runId?: string; eventType: string; createdAt: string; }
interface UsageView { status: string; taskUsed: number; taskQuota: number; }

interface PipelineDraft {
  sourceType: 'template' | 'description';
  templateId: TemplateId;
  description: string;
  name: string;
  brief: string;
  targetAccountIds: string[];
  approvalPolicy: 'required' | 'auto_approve';
  tone: string;
  language: string;
}

const fallbackTemplates: PipelineTemplate[] = [
  { id: 'repurpose', name: 'Repurpose and schedule', description: 'Turn one brief into channel-ready posts with approval before publishing.', steps: ['Brief', 'AI drafts', 'Review', 'Schedule'] },
  { id: 'weekly_report', name: 'Weekly growth report', description: 'Collect performance and prepare an approval-ready weekly summary.', steps: ['Weekly trigger', 'Pull analytics', 'AI summary', 'Review'] },
  { id: 'comment_lead', name: 'Comment-to-lead review', description: 'Classify high-intent comments and hand qualified leads to your team.', steps: ['Watch comments', 'AI classify', 'Review', 'Hand off'] },
];

const socialPlatforms = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'],
  ['pinterest', 'Pinterest'], ['googlebusiness', 'Google Business'], ['snapchat', 'Snapchat'],
  ['whatsapp', 'WhatsApp'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['twitter', 'X / Twitter'],
] as const;

function freshDraft(): PipelineDraft {
  return { sourceType: 'template', templateId: 'repurpose', description: '', name: '', brief: '', targetAccountIds: [], approvalPolicy: 'required', tone: 'clear, helpful', language: 'en' };
}

export default function PlatformDashboard() {
  const [token, setToken] = useState(readSessionAccessToken);
  const [section, setSection] = useState<Section>('pipelines');
  const [templates, setTemplates] = useState<PipelineTemplate[]>(fallbackTemplates);
  const [pipelines, setPipelines] = useState<PipelineView[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [wizardStep, setWizardStep] = useState<WizardStep | null>(null);
  const [draft, setDraft] = useState<PipelineDraft>(freshDraft);
  const [savedPipeline, setSavedPipeline] = useState<PipelineView | null>(null);
  const [readiness, setReadiness] = useState<PipelineReadiness | null>(null);
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEventView[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState('other');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [referralUrl, setReferralUrl] = useState('');
  const [referralStatus, setReferralStatus] = useState('');

  const selectedTemplate = useMemo(() => templates.find((template) => template.id === draft.templateId), [draft.templateId, templates]);
  const healthyAccounts = accounts.filter((account) => account.status === 'connected');

  const headers = useCallback((json = false): HeadersInit => {
    return { authorization: `Bearer ${token}`, ...(json ? { 'content-type': 'application/json' } : {}) };
  }, [token]);

  const loadWorkspace = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const requests = await Promise.all([
      fetch(`${gatewayUrl}/api/pipeline-templates`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/pipelines`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/zernio/accounts`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/approval-requests`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/billing/usage`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/billing/task-events`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/audit-events`, { headers: headers() }),
    ]);
      const [templatesResponse, pipelinesResponse, accountsResponse, approvalsResponse, usageResponse, tasksResponse, auditResponse] = requests;
      if (templatesResponse.ok) setTemplates(await templatesResponse.json() as PipelineTemplate[]);
      if (pipelinesResponse.ok) setPipelines(await pipelinesResponse.json() as PipelineView[]);
      if (accountsResponse.ok) setAccounts(await accountsResponse.json() as ConnectedAccount[]);
      if (approvalsResponse.ok) setApprovals(await approvalsResponse.json() as ApprovalView[]);
      if (usageResponse.ok) setUsage(await usageResponse.json() as UsageView);
      if (tasksResponse.ok) setTaskEvents(await tasksResponse.json() as TaskEventView[]);
      if (auditResponse.ok) setAuditEvents(await auditResponse.json() as AuditEventView[]);
      if (requests.every((response) => !response.ok)) setMessage('The workspace could not be loaded. Check your session permissions.');
    } catch {
      setMessage('Piggybot could not reach the workspace service. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [headers, token]);

  const refreshAccounts = useCallback(async (sync = false) => {
    if (!token) return;
    if (sync) await fetch(`${gatewayUrl}/api/zernio/sync`, { method: 'POST', headers: headers() });
    const response = await fetch(`${gatewayUrl}/api/zernio/accounts`, { headers: headers() });
    if (response.ok) setAccounts(await response.json() as ConnectedAccount[]);
  }, [headers, token]);

  useEffect(() => {
    if (!token) return;
    const timeout = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkspace, token]);

  useEffect(() => {
    const gatewayOrigin = new URL(gatewayUrl, window.location.origin).origin;
    const listener = (event: MessageEvent) => {
      if (event.origin !== gatewayOrigin || (event.data as { type?: string } | null)?.type !== 'piggybot:zernio-connected') return;
      setMessage('Account connected. Refreshing your destinations…');
      void refreshAccounts(true);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [refreshAccounts]);

  async function connectSocial(platform: typeof socialPlatforms[number][0]) {
    setMessage(''); setConnecting(platform);
    const response = await fetch(`${gatewayUrl}/api/zernio/connect?platform=${encodeURIComponent(platform)}`, { headers: headers() });
    const result = await response.json().catch(() => ({})) as { url?: string };
    setConnecting('');
    if (!response.ok || !result.url) { setMessage('The connection could not be started. Check your session and connector configuration.'); return; }
    window.open(result.url, 'piggybot-zernio-connect', 'popup,width=720,height=820');
  }

  function startTemplate(template: PipelineTemplate) {
    setDraft({ ...freshDraft(), sourceType: 'template', templateId: template.id, name: template.name, brief: template.description });
    setSavedPipeline(null); setReadiness(null); setWizardStep('configure');
  }

  function startDescription() {
    setDraft({ ...freshDraft(), sourceType: 'description' });
    setSavedPipeline(null); setReadiness(null); setWizardStep('configure');
  }

  function continuePipeline(pipeline: PipelineView) {
    const source = pipeline.definition.source;
    setDraft({
      sourceType: source.type,
      templateId: source.type === 'template' ? source.templateId : 'repurpose',
      description: source.type === 'description' ? source.description : '',
      name: pipeline.name,
      brief: pipeline.definition.brief,
      targetAccountIds: pipeline.definition.targetAccountIds,
      approvalPolicy: pipeline.definition.approvalPolicy,
      tone: pipeline.definition.tone,
      language: pipeline.definition.language,
    });
    setSavedPipeline(pipeline); setReadiness(null); setWizardStep('configure');
  }

  function toggleAccount(accountId: string) {
    setDraft((current) => ({ ...current, targetAccountIds: current.targetAccountIds.includes(accountId) ? current.targetAccountIds.filter((id) => id !== accountId) : [...current.targetAccountIds, accountId] }));
  }

  async function saveDraft() {
    setMessage(''); setLoading(true);
    const payload = {
      name: draft.name,
      source: draft.sourceType === 'template' ? { type: 'template', templateId: draft.templateId } : { type: 'description', description: draft.description || draft.brief },
      configuration: { brief: draft.brief, targetAccountIds: draft.targetAccountIds, approvalPolicy: draft.approvalPolicy, tone: draft.tone, language: draft.language },
    };
    const editing = Boolean(savedPipeline?.status === 'draft');
    const response = await fetch(editing ? `${gatewayUrl}/api/pipelines/${savedPipeline!.id}` : `${gatewayUrl}/api/pipelines`, {
      method: editing ? 'PATCH' : 'POST', headers: headers(true), body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({})) as PipelineView & { error?: string };
    setLoading(false);
    if (!response.ok || !result.id) { setMessage(result.error ?? 'The pipeline draft could not be saved.'); return; }
    setSavedPipeline(result); setReadiness(null); setWizardStep('saved');
    await loadWorkspace();
  }

  async function testSetup() {
    if (!savedPipeline) return;
    setLoading(true);
    const response = await fetch(`${gatewayUrl}/api/pipelines/${savedPipeline.id}/test`, { method: 'POST', headers: headers() });
    const result = await response.json().catch(() => null) as PipelineReadiness | null;
    setLoading(false);
    if (!response.ok || !result) { setMessage('The readiness check could not be completed.'); return; }
    setReadiness(result);
  }

  async function activateSavedPipeline() {
    if (!savedPipeline || !readiness?.ready) return;
    setLoading(true);
    const response = await fetch(`${gatewayUrl}/api/pipelines/${savedPipeline.id}/activate`, { method: 'POST', headers: headers() });
    const result = await response.json().catch(() => ({})) as PipelineView;
    setLoading(false);
    if (!response.ok || !result.id) { setMessage('The pipeline could not be activated. Run the readiness check again.'); return; }
    setSavedPipeline(result); setMessage(`${result.name} is active.`); setWizardStep(null); await loadWorkspace();
  }

  async function loadRun() {
    const response = await fetch(`${gatewayUrl}/api/runs/${runId}`, { headers: headers() });
    if (!response.ok) { setRun(null); setMessage('Run not found or access is denied.'); return; }
    setRun(await response.json() as RunView);
  }

  async function decideApproval(approvalId: string, decision: 'approved' | 'rejected') {
    const response = await fetch(`${gatewayUrl}/api/approval-requests/${approvalId}/${decision}`, { method: 'POST', headers: headers(true), body: '{}' });
    setMessage(response.ok ? `Approval ${decision}.` : 'The approval decision could not be saved.');
    if (response.ok) await loadWorkspace();
  }

  async function sendFeedback() {
    setFeedbackStatus('');
    const response = await fetch(`${gatewayUrl}/api/feedback`, { method: 'POST', headers: headers(true), body: JSON.stringify({ category: feedbackCategory, message: feedbackMessage, locale: document.documentElement.lang.slice(0, 2), pageUrl: window.location.href }) });
    const result = await response.json().catch(() => ({})) as { ticketId?: string };
    if (!response.ok || !result.ticketId) { setFeedbackStatus('Your message could not be sent. Confirm that your workspace session is active.'); return; }
    setFeedbackMessage(''); setFeedbackStatus(`Thanks — ticket ${result.ticketId} was sent to support.`);
  }

  async function createReferralLink() {
    const response = await fetch(`${gatewayUrl}/api/referral/link`, { method: 'POST', headers: headers() });
    const result = await response.json().catch(() => ({})) as { url?: string };
    if (!response.ok || !result.url) { setReferralStatus('A workspace owner or admin session is required.'); return; }
    setReferralUrl(result.url); setReferralStatus('Share this link and earn 20% credit on eligible first-year payments.');
  }

  return (
    <main className="paper-grain min-h-screen bg-paper text-ink">
      <header className="border-b-2 border-ink/20 bg-paper-card px-6 py-5 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="font-hand text-lg text-sky-deep">Piggybot Platform</p><h1 className="font-display text-3xl">Marketing workspace</h1></div>
          <nav className="flex flex-wrap gap-2" aria-label="Workspace navigation">
            {([['pipelines', 'Pipelines'], ['accounts', 'Accounts'], ['activity', 'Activity'], ['settings', 'Settings']] as const).map(([id, label]) => <button key={id} onClick={() => setSection(id)} className={`rounded-full px-4 py-2 text-sm font-medium ${section === id ? 'bg-sky-deep text-white' : 'bg-paper text-ink-soft hover:bg-sky-pale'}`}>{label}</button>)}
          </nav>
          <div className="flex gap-4 text-sm"><a className="text-ink-soft hover:text-ink" href="/app/admin">Admin</a><a className="text-ink-soft hover:text-ink" href="/contact">Help</a><a className="text-ink-soft hover:text-ink" href="/">Website</a></div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-6 md:p-10">
        {message && <div className="mb-6 rounded-xl border border-sky-deep/20 bg-sky-pale p-4 text-sm text-sky-deep" role="status">{message}</div>}
        {!token && <SessionGate token={token} setToken={setToken} />}
        {token && section === 'pipelines' && <PipelinesSection templates={templates} pipelines={pipelines} usage={usage} loading={loading} onNew={() => { setDraft(freshDraft()); setSavedPipeline(null); setReadiness(null); setWizardStep('start'); }} onTemplate={startTemplate} onContinue={continuePipeline} onActivity={() => setSection('activity')} />}
        {token && section === 'accounts' && <AccountsSection accounts={accounts} connecting={connecting} onConnect={connectSocial} onRefresh={() => void refreshAccounts(true)} />}
        {token && section === 'activity' && <ActivitySection approvals={approvals} taskEvents={taskEvents} auditEvents={auditEvents} runId={runId} setRunId={setRunId} run={run} onLoadRun={() => void loadRun()} onDecision={decideApproval} />}
        {token && section === 'settings' && <SettingsSection token={token} setToken={setToken} feedbackCategory={feedbackCategory} setFeedbackCategory={setFeedbackCategory} feedbackMessage={feedbackMessage} setFeedbackMessage={setFeedbackMessage} feedbackStatus={feedbackStatus} onFeedback={() => void sendFeedback()} referralUrl={referralUrl} referralStatus={referralStatus} onReferral={() => void createReferralLink()} />}
      </div>

      {wizardStep && <PipelineWizard step={wizardStep} draft={draft} setDraft={setDraft} templates={templates} selectedTemplate={draft.sourceType === 'template' ? selectedTemplate : undefined} accounts={healthyAccounts} savedPipeline={savedPipeline} readiness={readiness} loading={loading} onClose={() => setWizardStep(null)} onStep={setWizardStep} onTemplate={startTemplate} onDescription={startDescription} onToggleAccount={toggleAccount} onSave={() => void saveDraft()} onTest={() => void testSetup()} onActivate={() => void activateSavedPipeline()} />}
    </main>
  );
}

function PipelinesSection({ templates, pipelines, usage, loading, onNew, onTemplate, onContinue, onActivity }: { templates: PipelineTemplate[]; pipelines: PipelineView[]; usage: UsageView | null; loading: boolean; onNew: () => void; onTemplate: (template: PipelineTemplate) => void; onContinue: (pipeline: PipelineView) => void; onActivity: () => void; }) {
  const active = pipelines.filter((pipeline) => pipeline.status === 'published').length;
  return <div className="space-y-8">
    <section className="grid gap-4 md:grid-cols-3">
      <Stat label="Active pipelines" value={String(active)} detail={`${pipelines.length - active} draft${pipelines.length - active === 1 ? '' : 's'}`} />
      <Stat label="Task usage" value={usage ? `${usage.taskUsed} / ${usage.taskQuota}` : '—'} detail={usage?.status === 'degraded' ? 'Energy-saving mode' : 'Current billing period'} />
      <button onClick={onNew} className="wobble sketch bg-sunset p-5 text-left text-white shadow-paint transition hover:-translate-y-1"><span className="block text-sm font-semibold uppercase tracking-wide">Create</span><span className="mt-2 block font-display text-2xl">New automation →</span></button>
    </section>

    <section>
      <div className="flex items-end justify-between gap-4"><div><p className="font-hand text-lg text-sky-deep">Your automation shelf</p><h2 className="font-display text-3xl">My Pipelines</h2></div>{loading && <span className="text-sm text-ink-soft">Refreshing…</span>}</div>
      {pipelines.length === 0 ? <EmptyState title="No pipelines yet" detail="Choose a proven template or describe the result you want. Piggybot will create a safe, editable draft." action="Create your first pipeline" onAction={onNew} /> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{pipelines.map((pipeline) => <article key={pipeline.id} className="sketch bg-paper-card p-5 shadow-paint-sm"><div className="flex items-center justify-between gap-3"><StatusBadge status={pipeline.status} /><span className="text-xs text-ink-soft">v{pipeline.version}</span></div><h3 className="mt-4 text-lg font-semibold">{pipeline.name}</h3><p className="mt-2 line-clamp-2 text-sm text-ink-soft">{pipeline.definition.brief}</p><div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-sky-pale px-2 py-1">{pipeline.definition.targetAccountIds.length} destination{pipeline.definition.targetAccountIds.length === 1 ? '' : 's'}</span><span className="rounded-full bg-sun/30 px-2 py-1">Approval {pipeline.definition.approvalPolicy === 'required' ? 'required' : 'assisted'}</span>{pipeline.lastRunStatus && <span className="rounded-full bg-meadow-light px-2 py-1">Last run: {pipeline.lastRunStatus}</span>}</div><button onClick={() => pipeline.status === 'draft' ? onContinue(pipeline) : onActivity()} className="mt-5 w-full rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">{pipeline.status === 'draft' ? 'Continue setup' : 'View activity'}</button></article>)}</div>}
    </section>

    <section><p className="font-hand text-lg text-sky-deep">Proven starting points</p><h2 className="font-display text-3xl">Standard templates</h2><div className="mt-5 grid gap-4 md:grid-cols-3">{templates.map((template) => <TemplateCard key={template.id} template={template} onClick={() => onTemplate(template)} />)}</div></section>
  </div>;
}

function AccountsSection({ accounts, connecting, onConnect, onRefresh }: { accounts: ConnectedAccount[]; connecting: string; onConnect: (platform: typeof socialPlatforms[number][0]) => void; onRefresh: () => void; }) {
  return <div className="space-y-8"><section><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-hand text-lg text-sky-deep">White-label connections</p><h2 className="font-display text-3xl">Connected Accounts</h2><p className="mt-2 max-w-2xl text-sm text-ink-soft">Authorize with the social network, then choose pages, organizations, boards, or phone numbers inside a Piggybot-branded flow.</p></div><button onClick={onRefresh} className="rounded-md border border-ink/25 px-4 py-2 text-sm font-medium hover:bg-sky-pale">Sync account health</button></div>{accounts.length === 0 ? <EmptyState title="No connected accounts" detail="Connect at least one destination before activating a pipeline." /> : <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <article key={account.id} className="sketch bg-paper-card p-5"><div className="flex items-start justify-between gap-4"><div><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">{platformLabel(account.platform)}</span><h3 className="mt-1 font-semibold">{account.displayName}</h3></div><StatusBadge status={account.status} /></div><p className="mt-4 text-xs text-ink-soft">{account.capabilities.length ? account.capabilities.join(' · ') : 'Capabilities update after the next sync.'}</p></article>)}</div>}</section><section><h3 className="text-lg font-semibold">Add another destination</h3><div className="mt-4 flex flex-wrap gap-2">{socialPlatforms.map(([id, label]) => <button key={id} disabled={Boolean(connecting)} onClick={() => onConnect(id)} className="rounded-md border border-ink/30 bg-paper-card px-4 py-2 text-sm font-medium hover:bg-sky-pale disabled:opacity-50">{connecting === id ? 'Opening…' : `Connect ${label}`}</button>)}</div></section></div>;
}

function ActivitySection({ approvals, taskEvents, auditEvents, runId, setRunId, run, onLoadRun, onDecision }: { approvals: ApprovalView[]; taskEvents: TaskEventView[]; auditEvents: AuditEventView[]; runId: string; setRunId: (value: string) => void; run: RunView | null; onLoadRun: () => void; onDecision: (id: string, decision: 'approved' | 'rejected') => Promise<void>; }) {
  return <div className="space-y-8"><section><p className="font-hand text-lg text-sky-deep">Human control</p><h2 className="font-display text-3xl">Approvals & Activity</h2><div className="mt-5 grid gap-6 lg:grid-cols-3"><Feed title="Approvals" empty="No actions are waiting for approval.">{approvals.map((approval) => <div key={approval.id} className="border-b border-ink/10 py-3 text-sm"><p>{approval.requestedAction.summary ?? 'Publishing action'}</p><p className="mt-1 text-xs text-ink-soft">{new Date(approval.requestedAt).toLocaleString()}</p><div className="mt-2 flex gap-2"><button className="rounded bg-sky-deep px-2 py-1 text-xs text-white" onClick={() => void onDecision(approval.id, 'approved')}>Approve</button><button className="rounded border border-ink/30 px-2 py-1 text-xs" onClick={() => void onDecision(approval.id, 'rejected')}>Reject</button></div></div>)}</Feed><Feed title="Successful actions" empty="No billable actions yet.">{taskEvents.map((event) => <div key={event.id} className="border-b border-ink/10 py-3 text-sm"><p>{event.actionType}: {event.billableUnits} unit(s)</p><p className="mt-1 text-xs text-ink-soft">{event.status} · {new Date(event.createdAt).toLocaleString()}</p></div>)}</Feed><Feed title="Audit trail" empty="No audit events yet.">{auditEvents.map((event) => <div key={event.id} className="border-b border-ink/10 py-3 text-sm"><p>{event.eventType}</p><p className="mt-1 text-xs text-ink-soft">{new Date(event.createdAt).toLocaleString()}</p></div>)}</Feed></div></section><section className="rounded-xl border border-ink/20 bg-paper-card p-5"><h3 className="text-lg font-semibold">Find a specific run</h3><div className="mt-4 flex flex-col gap-3 md:flex-row"><input value={runId} onChange={(event) => setRunId(event.target.value)} className="flex-1 rounded-md border border-ink/20 bg-paper p-3" placeholder="Workflow run UUID" /><button onClick={onLoadRun} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white">Load run</button></div>{run && <div className="mt-5 grid gap-3 rounded-lg bg-sky-pale p-4 text-sm md:grid-cols-3"><span>Status: <b>{run.status}</b></span><span>Workflow: {run.workflowId}</span><span>Created: {new Date(run.createdAt).toLocaleString()}</span></div>}</section></div>;
}

function SettingsSection({ token, setToken, feedbackCategory, setFeedbackCategory, feedbackMessage, setFeedbackMessage, feedbackStatus, onFeedback, referralUrl, referralStatus, onReferral }: { token: string; setToken: (value: string) => void; feedbackCategory: string; setFeedbackCategory: (value: string) => void; feedbackMessage: string; setFeedbackMessage: (value: string) => void; feedbackStatus: string; onFeedback: () => void; referralUrl: string; referralStatus: string; onReferral: () => void; }) {
  return <div className="grid gap-6 lg:grid-cols-2"><section className="sketch bg-paper-card p-5"><h2 className="text-lg font-semibold">Workspace session</h2><p className="mt-1 text-sm text-ink-soft">Activation links create a short-lived session scoped to this tab.</p><label className="mt-4 block text-sm text-ink-soft">Access token</label><input type="password" value={token} onChange={(event) => setToken(event.target.value)} className="mt-2 w-full rounded-md border border-ink/20 bg-paper p-3 text-xs" autoComplete="off" /><button onClick={() => { clearSessionAccessToken(); setToken(''); }} className="mt-3 rounded-md border border-ink/20 px-4 py-2 text-sm font-medium">Clear session</button></section><section className="sketch bg-paper-card p-5"><h2 className="text-lg font-semibold">Refer & earn 20%</h2><p className="mt-1 text-sm text-ink-soft">Earn account credit after an eligible referral clears its refund window.</p><input readOnly value={referralUrl} className="mt-4 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder="Generate your personal referral link" /><div className="mt-3 flex gap-2"><button onClick={onReferral} className="rounded-md bg-sunset px-4 py-2 text-sm font-medium text-white">Generate link</button>{referralUrl && <button onClick={() => void navigator.clipboard.writeText(referralUrl)} className="rounded-md border border-ink/30 px-4 py-2 text-sm font-medium">Copy</button>}</div>{referralStatus && <p className="mt-3 text-sm text-sky-deep">{referralStatus}</p>}</section><section className="sketch bg-paper-card p-5 lg:col-span-2"><h2 className="text-lg font-semibold">Help & support</h2><div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]"><select value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value)} className="rounded-md border border-ink/20 bg-paper p-3"><option value="billing">Billing</option><option value="bug">Bug</option><option value="feature">Feature request</option><option value="other">Other</option></select><textarea value={feedbackMessage} maxLength={2000} onChange={(event) => setFeedbackMessage(event.target.value)} className="min-h-24 rounded-md border border-ink/20 bg-paper p-3" placeholder="How can we help?" /><button disabled={!feedbackMessage.trim()} onClick={onFeedback} className="h-fit rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:opacity-50">Send to support</button></div>{feedbackStatus && <p className="mt-3 text-sm text-sky-deep">{feedbackStatus}</p>}</section></div>;
}

function PipelineWizard({ step, draft, setDraft, templates, selectedTemplate, accounts, savedPipeline, readiness, loading, onClose, onStep, onTemplate, onDescription, onToggleAccount, onSave, onTest, onActivate }: { step: WizardStep; draft: PipelineDraft; setDraft: React.Dispatch<React.SetStateAction<PipelineDraft>>; templates: PipelineTemplate[]; selectedTemplate?: PipelineTemplate; accounts: ConnectedAccount[]; savedPipeline: PipelineView | null; readiness: PipelineReadiness | null; loading: boolean; onClose: () => void; onStep: (step: WizardStep) => void; onTemplate: (template: PipelineTemplate) => void; onDescription: () => void; onToggleAccount: (id: string) => void; onSave: () => void; onTest: () => void; onActivate: () => void; }) {
  const steps = ['Starting point', 'Configure', 'Accounts', 'Review', 'Activate'];
  const index = ({ start: 0, configure: 1, accounts: 2, review: 3, saved: 4 } as const)[step];
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"><div className="mx-auto my-4 max-w-4xl rounded-2xl bg-paper shadow-2xl"><header className="flex items-start justify-between border-b border-ink/15 p-6"><div><p className="font-hand text-lg text-sky-deep">New automation</p><h2 className="font-display text-3xl">Build your pipeline</h2></div><button onClick={onClose} className="rounded-full border border-ink/20 px-3 py-1 text-sm">Close</button></header><div className="grid gap-1 border-b border-ink/10 px-6 py-4 sm:grid-cols-5">{steps.map((label, stepIndex) => <div key={label} className={`rounded px-2 py-2 text-xs font-medium ${stepIndex === index ? 'bg-sky-deep text-white' : stepIndex < index ? 'bg-meadow-light text-ink' : 'bg-paper-card text-ink-soft'}`}>{stepIndex + 1}. {label}</div>)}</div><div className="p-6 md:p-8">
    {step === 'start' && <div><h3 className="text-xl font-semibold">How would you like to start?</h3><p className="mt-1 text-sm text-ink-soft">Both paths create an editable pipeline draft.</p><div className="mt-6 grid gap-4 md:grid-cols-2">{templates.map((template) => <TemplateCard key={template.id} template={template} onClick={() => onTemplate(template)} />)}<button onClick={onDescription} className="sketch border-2 border-dashed border-sky-deep/40 bg-sky-pale p-5 text-left transition hover:-translate-y-1"><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">Custom</span><span className="mt-2 block text-lg font-semibold">Describe what you want</span><span className="mt-2 block text-sm text-ink-soft">Start with a plain-language outcome and a safe approval-first structure.</span></button></div></div>}
    {step === 'configure' && <div className="space-y-5"><div><h3 className="text-xl font-semibold">Configure the outcome</h3><p className="mt-1 text-sm text-ink-soft">Name the pipeline and give Piggybot the context it needs.</p></div>{draft.sourceType === 'description' && <Field label="What should this automation do?"><textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value, brief: event.target.value }))} className="min-h-24 w-full rounded-md border border-ink/20 bg-paper-card p-3" placeholder="Example: Turn every product launch brief into LinkedIn and Instagram drafts for approval." /></Field>}<Field label="Pipeline name"><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-md border border-ink/20 bg-paper-card p-3" placeholder="Product launch distribution" /></Field><Field label="Working brief"><textarea value={draft.brief} onChange={(event) => setDraft((current) => ({ ...current, brief: event.target.value }))} className="min-h-28 w-full rounded-md border border-ink/20 bg-paper-card p-3" /></Field><div className="grid gap-4 md:grid-cols-3"><Field label="Tone"><input value={draft.tone} onChange={(event) => setDraft((current) => ({ ...current, tone: event.target.value }))} className="w-full rounded-md border border-ink/20 bg-paper-card p-3" /></Field><Field label="Language"><select value={draft.language} onChange={(event) => setDraft((current) => ({ ...current, language: event.target.value }))} className="w-full rounded-md border border-ink/20 bg-paper-card p-3"><option value="en">English</option><option value="zh">中文</option><option value="es">Español</option></select></Field><Field label="Approval policy"><select value={draft.approvalPolicy} onChange={(event) => setDraft((current) => ({ ...current, approvalPolicy: event.target.value as PipelineDraft['approvalPolicy'] }))} className="w-full rounded-md border border-ink/20 bg-paper-card p-3"><option value="required">Always require approval</option><option value="auto_approve">Assisted approval</option></select></Field></div><WizardActions back={() => onStep(savedPipeline ? 'saved' : 'start')} next={() => onStep('accounts')} nextDisabled={draft.name.trim().length < 3 || draft.brief.trim().length < 10 || (draft.sourceType === 'description' && draft.description.trim().length < 10)} /></div>}
    {step === 'accounts' && <div><h3 className="text-xl font-semibold">Choose destinations</h3><p className="mt-1 text-sm text-ink-soft">Pipelines remain drafts until their selected accounts are connected and healthy.</p>{accounts.length === 0 ? <EmptyState title="Connect an account first" detail="Close this builder, open Accounts, and connect a destination through the Piggybot-branded flow." /> : <div className="mt-6 grid gap-3 md:grid-cols-2">{accounts.map((account) => <label key={account.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${draft.targetAccountIds.includes(account.id) ? 'border-sky-deep bg-sky-pale' : 'border-ink/15 bg-paper-card'}`}><input type="checkbox" checked={draft.targetAccountIds.includes(account.id)} onChange={() => onToggleAccount(account.id)} /><span><strong className="block">{account.displayName}</strong><small className="text-ink-soft">{platformLabel(account.platform)} · {account.status}</small></span></label>)}</div>}<WizardActions back={() => onStep('configure')} next={() => onStep('review')} nextLabel={draft.targetAccountIds.length ? 'Review pipeline' : 'Save without accounts'} /></div>}
    {step === 'review' && <div><h3 className="text-xl font-semibold">Review the pipeline draft</h3><div className="mt-5 grid gap-5 md:grid-cols-2"><div className="rounded-xl bg-paper-card p-5"><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">Pipeline</span><h4 className="mt-2 text-lg font-semibold">{draft.name}</h4><p className="mt-2 text-sm text-ink-soft">{draft.brief}</p><dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between gap-4"><dt>Tone</dt><dd className="text-ink-soft">{draft.tone}</dd></div><div className="flex justify-between gap-4"><dt>Approval</dt><dd className="text-ink-soft">{draft.approvalPolicy === 'required' ? 'Always required' : 'Assisted'}</dd></div><div className="flex justify-between gap-4"><dt>Destinations</dt><dd className="text-ink-soft">{draft.targetAccountIds.length}</dd></div></dl></div><div className="rounded-xl bg-sky-pale p-5"><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">Planned steps</span><ol className="mt-3 space-y-3">{(selectedTemplate?.steps ?? ['Understand outcome', 'AI prepares work', 'Human review', 'Execute safely']).map((item, stepIndex) => <li key={item} className="flex gap-3 text-sm"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-deep text-xs text-white">{stepIndex + 1}</span>{item}</li>)}</ol></div></div><WizardActions back={() => onStep('accounts')} next={onSave} nextLabel={loading ? 'Saving…' : savedPipeline ? 'Update draft' : 'Save pipeline draft'} nextDisabled={loading} /></div>}
    {step === 'saved' && savedPipeline && <div><h3 className="text-xl font-semibold">Test before activation</h3><p className="mt-1 text-sm text-ink-soft">This readiness test performs no external publishing action.</p><div className="mt-6 rounded-xl bg-paper-card p-5"><div className="flex items-center justify-between"><div><StatusBadge status={savedPipeline.status} /><h4 className="mt-3 text-lg font-semibold">{savedPipeline.name}</h4></div><button onClick={() => onStep('configure')} className="rounded-md border border-ink/20 px-4 py-2 text-sm">Edit setup</button></div>{readiness ? <div className="mt-5 space-y-3">{readiness.checks.map((check) => <div key={check.id} className="flex gap-3 rounded-lg border border-ink/10 bg-paper p-3"><span className={`font-bold ${check.passed ? 'text-meadow-deep' : 'text-sunset'}`}>{check.passed ? '✓' : '!'}</span><div><p className="text-sm font-medium">{check.label}</p><p className="text-xs text-ink-soft">{check.detail}</p></div></div>)}</div> : <p className="mt-5 rounded-lg bg-sky-pale p-4 text-sm">Run the readiness check to validate the brief, destinations, account health, and approval guardrail.</p>}</div><div className="mt-6 flex flex-wrap justify-end gap-3"><button onClick={onClose} className="rounded-md border border-ink/20 px-5 py-3 font-medium">Keep as draft</button><button disabled={loading} onClick={onTest} className="rounded-md border border-sky-deep px-5 py-3 font-medium text-sky-deep disabled:opacity-50">{loading ? 'Checking…' : 'Test setup'}</button><button disabled={!readiness?.ready || loading} onClick={onActivate} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">Activate pipeline</button></div></div>}
  </div></div></div>;
}

function SessionGate({ token, setToken }: { token: string; setToken: (value: string) => void; }) { return <section className="mx-auto max-w-xl sketch bg-paper-card p-6 text-center shadow-paint"><p className="font-hand text-lg text-sky-deep">Welcome back</p><h2 className="font-display text-3xl">Open your workspace</h2><p className="mt-2 text-sm text-ink-soft">Use the short-lived token from your activation link.</p><input type="password" value={token} onChange={(event) => setToken(event.target.value)} className="mt-5 w-full rounded-md border border-ink/20 bg-paper p-3 text-sm" placeholder="Workspace access token" autoComplete="off" /></section>; }
function TemplateCard({ template, onClick }: { template: PipelineTemplate; onClick: () => void; }) { return <button onClick={onClick} className="wobble-2 sketch bg-paper-card p-5 text-left shadow-paint-sm transition hover:-translate-y-1 hover:bg-sky-pale"><span className="text-xs font-semibold uppercase tracking-wide text-sky-deep">Standard template</span><span className="mt-2 block text-lg font-semibold">{template.name}</span><span className="mt-2 block text-sm text-ink-soft">{template.description}</span><span className="mt-4 block text-xs font-medium text-sky-deep">Use this template →</span></button>; }
function Stat({ label, value, detail }: { label: string; value: string; detail: string; }) { return <div className="sketch bg-paper-card p-5 shadow-paint-sm"><p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p><p className="mt-2 font-display text-3xl">{value}</p><p className="mt-1 text-xs text-ink-soft">{detail}</p></div>; }
function StatusBadge({ status }: { status: string }) { const active = status === 'published' || status === 'connected' || status === 'succeeded'; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${active ? 'bg-meadow-light text-meadow-deep' : status === 'draft' || status === 'syncing' ? 'bg-sun/35 text-ink' : 'bg-sunset/15 text-sunset'}`}>{status === 'published' ? 'Active' : status}</span>; }
function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void; }) { return <div className="mt-5 rounded-xl border-2 border-dashed border-ink/15 bg-paper-card p-8 text-center"><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-lg text-sm text-ink-soft">{detail}</p>{action && onAction && <button onClick={onAction} className="mt-4 rounded-md bg-sky-deep px-5 py-2 text-sm font-medium text-white">{action}</button>}</div>; }
function Feed({ title, empty, children }: { title: string; empty: string; children: ReactNode }) { return <section className="wobble sketch bg-paper-card p-5"><h3 className="text-lg font-semibold">{title}</h3><div className="mt-3">{children || <p className="text-sm text-ink-soft">{empty}</p>}</div></section>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-medium">{label}</span>{children}</label>; }
function WizardActions({ back, next, nextLabel = 'Continue', nextDisabled = false }: { back: () => void; next: () => void; nextLabel?: string; nextDisabled?: boolean; }) { return <div className="flex justify-between gap-3 pt-3"><button onClick={back} className="rounded-md border border-ink/20 px-5 py-3 font-medium">Back</button><button disabled={nextDisabled} onClick={next} className="rounded-md bg-sky-deep px-5 py-3 font-medium text-white disabled:opacity-40">{nextLabel}</button></div>; }
function platformLabel(platform: string): string { return socialPlatforms.find(([id]) => id === platform)?.[1] ?? platform.replaceAll('_', ' '); }
