import { useState } from 'react';

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:4100';

interface RunView { id: string; status: string; workflowId: string; createdAt: string; }
const templates = [{ id: 'repurpose', name: 'Repurpose and schedule' }, { id: 'weekly_report', name: 'Weekly growth report' }, { id: 'comment_lead', name: 'Comment-to-lead review' }] as const;

export default function PlatformDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem('piggybot_access_token') ?? '');
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState('');

  async function loadRun() {
    setError('');
    localStorage.setItem('piggybot_access_token', token);
    const response = await fetch(`${gatewayUrl}/api/runs/${runId}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) { setRun(null); setError('Run not found or access is denied.'); return; }
    setRun(await response.json() as RunView);
  }

  async function publishTemplate(templateId: typeof templates[number]['id']) {
    setError(''); localStorage.setItem('piggybot_access_token', token);
    const response = await fetch(`${gatewayUrl}/api/workflow-templates/${templateId}/publish`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) { setError('Template publishing needs an editor or admin token.'); return; }
    const workflow = await response.json() as { workflowId: string; name: string };
    setError(`${workflow.name} is published. Create a run with workflow ${workflow.workflowId}.`);
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
          <p className="mt-1 text-sm text-slate-400">Templates become versioned workflows once a workspace administrator publishes them.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {templates.map(({ id, name }) => (
              <button key={id} className="wobble-2 sketch bg-sky-pale p-4 text-left shadow-paint-sm transition hover:-translate-y-1 hover:bg-sun/40" onClick={() => void publishTemplate(id)}>
                <span className="block font-medium">{name}</span><span className="mt-2 block text-xs text-slate-400">Approval-first</span>
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Session</h2>
          <label className="mt-4 block text-sm text-slate-400">Access token</label>
          <textarea value={token} onChange={(event) => setToken(event.target.value)} className="mt-2 h-28 w-full rounded-md border border-slate-700 bg-slate-950 p-2 text-xs" placeholder="Paste a workspace-scoped access token" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Run timeline</h2>
        <div className="mt-4 flex flex-col gap-3 md:flex-row"><input value={runId} onChange={(event) => setRunId(event.target.value)} className="flex-1 rounded-md border border-slate-700 bg-slate-950 p-3" placeholder="Workflow run UUID" /><button onClick={() => void loadRun()} className="rounded-md bg-emerald-500 px-5 py-3 font-medium text-slate-950">Load run</button></div>
        {error && <p className="mt-4 text-sm text-amber-300">{error}</p>}
        {run && <div className="mt-5 grid gap-3 rounded-lg bg-slate-950 p-4 text-sm md:grid-cols-3"><span>Status: <b className="text-emerald-400">{run.status}</b></span><span>Workflow: {run.workflowId}</span><span>Created: {new Date(run.createdAt).toLocaleString()}</span></div>}
      </section>
    </main>
  );
}
