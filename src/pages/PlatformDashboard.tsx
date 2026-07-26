import { useState, type ReactNode } from 'react';

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:4100';

interface RunView { id: string; status: string; workflowId: string; createdAt: string; }
interface ApprovalView { id: string; runId: string; requestedAction: { summary?: string }; requestedAt: string; }
interface TaskEventView { id: string; runId: string; actionType: string; billableUnits: string; status: string; createdAt: string; }
interface AuditEventView { id: string; runId?: string; eventType: string; createdAt: string; }
const templates = [{ id: 'repurpose', name: 'Repurpose and schedule' }, { id: 'weekly_report', name: 'Weekly growth report' }, { id: 'comment_lead', name: 'Comment-to-lead review' }] as const;

export default function PlatformDashboard() {
  // Keep a pasted operator token only in memory. Production sign-in should use
  // an HttpOnly session cookie supplied by the identity provider.
  const [token, setToken] = useState('');
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [taskEvents, setTaskEvents] = useState<TaskEventView[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventView[]>([]);
  const [message, setMessage] = useState('');

  function headers(): HeadersInit { return { authorization: `Bearer ${token}` }; }

  async function loadRun() {
    setMessage('');
    const response = await fetch(`${gatewayUrl}/api/runs/${runId}`, { headers: headers() });
    if (!response.ok) { setRun(null); setMessage('Run not found or access is denied.'); return; }
    setRun(await response.json() as RunView);
  }

  async function loadWorkspace() {
    setMessage('');
    const [approvalsResponse, usageResponse, auditResponse] = await Promise.all([
      fetch(`${gatewayUrl}/api/approval-requests`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/billing/task-events`, { headers: headers() }),
      fetch(`${gatewayUrl}/api/audit-events`, { headers: headers() }),
    ]);
    if (approvalsResponse.ok) setApprovals(await approvalsResponse.json() as ApprovalView[]);
    if (usageResponse.ok) setTaskEvents(await usageResponse.json() as TaskEventView[]);
    if (auditResponse.ok) setAuditEvents(await auditResponse.json() as AuditEventView[]);
    if (!approvalsResponse.ok && !usageResponse.ok && !auditResponse.ok) setMessage('The workspace data could not be loaded. Check your session permissions.');
  }

  async function publishTemplate(templateId: typeof templates[number]['id']) {
    setMessage('');
    const response = await fetch(`${gatewayUrl}/api/workflow-templates/${templateId}/publish`, { method: 'POST', headers: headers() });
    if (!response.ok) { setMessage('Template publishing needs an editor or administrator session.'); return; }
    const workflow = await response.json() as { workflowId: string; name: string };
    setMessage(`${workflow.name} is published. Create a run with workflow ${workflow.workflowId}.`);
    await loadWorkspace();
  }

  async function decideApproval(approvalId: string, decision: 'approved' | 'rejected') {
    const response = await fetch(`${gatewayUrl}/api/approval-requests/${approvalId}/${decision}`, { method: 'POST', headers: headers() });
    setMessage(response.ok ? `Approval ${decision}.` : 'The approval decision could not be saved.');
    if (response.ok) await loadWorkspace();
  }

  return (
    <main className="paper-grain min-h-screen bg-paper text-ink p-6 md:p-10">
      <header className="mx-auto max-w-6xl flex flex-col gap-4 border-b-2 border-ink/30 pb-6 md:flex-row md:items-end md:justify-between">
        <div><p className="font-hand text-xl text-sky-deep">Piggybot Platform</p><h1 className="font-display text-4xl">Workflow operations</h1></div>
        <a className="text-sm text-ink-soft hover:text-ink" href="/">Back to site</a>
      </header>

      <section className="mx-auto grid max-w-6xl gap-6 py-8 lg:grid-cols-3">
        <div className="wobble sketch shadow-paint bg-paper-card p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Start from a template</h2>
          <p className="mt-1 text-sm text-slate-500">Templates become versioned workflows when an editor publishes them.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {templates.map(({ id, name }) => (
              <button key={id} className="wobble-2 sketch bg-sky-pale p-4 text-left shadow-paint-sm transition hover:-translate-y-1 hover:bg-sun/40" onClick={() => void publishTemplate(id)}>
                <span className="block font-medium">{name}</span><span className="mt-2 block text-xs text-slate-500">Approval-first</span>
              </button>
            ))}
          </div>
        </div>
        <div className="wobble sketch bg-paper-card p-5">
          <h2 className="text-lg font-semibold">Session</h2>
          <label className="mt-4 block text-sm text-ink-soft">Access token</label>
          <textarea value={token} onChange={(event) => setToken(event.target.value)} className="mt-2 h-28 w-full rounded-md border border-ink/20 bg-paper p-2 text-xs" placeholder="Paste a short-lived workspace token" />
          <button onClick={() => void loadWorkspace()} className="mt-3 w-full rounded-md bg-sky-deep px-4 py-2 text-sm font-medium text-white">Load workspace</button>
        </div>
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
    </main>
  );
}

function Feed({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return <section className="wobble sketch bg-paper-card p-5"><h2 className="text-lg font-semibold">{title}</h2><div className="mt-3">{children || <p className="text-sm text-ink-soft">{empty}</p>}</div></section>;
}
