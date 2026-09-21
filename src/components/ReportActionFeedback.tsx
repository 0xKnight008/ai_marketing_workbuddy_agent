import { t } from '../workspace/translate';
import { useEffect, useState } from 'react';
import { readSessionAccessToken } from '../lib/auth-session';

type Feedback = { status: 'planned' | 'adopted' | 'completed' | 'dismissed'; effect: 'unknown' | 'improved' | 'unchanged' | 'worse'; note: string; updatedAt?: string };
type Action = { key: string; title: string; feedback: Feedback | null };
const headers = () => ({ Authorization: `Bearer ${readSessionAccessToken()}`, 'Content-Type': 'application/json' });

function ReportActionFeedbackContent({ reportId, apiBase }: { reportId: string; apiBase: string }) {
  const [actions, setActions] = useState<Action[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/api/insights/${reportId}/actions`, { headers: headers(), signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Unable to load action feedback'); return response.json(); })
      .then(data => { setActions(data.actions ?? []); setCanEdit(data.canEdit === true); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [apiBase, reportId]);
  return <section aria-label={t("Execution feedback")} className="rounded-xl border border-ink/15 p-4">
    <h3 className="text-lg font-semibold">{t("Execution feedback")}</h3>
    <p className="mt-2 text-xs text-ink-soft">{t("Manually record adoption, completion and observed effects. Saving does not execute, publish or approve anything, and uses no AI credits. Effects are self-reported, not measured automatically.")}</p>
    {error && <p role="alert" className="mt-2 text-sm">{t(error)}</p>}
    {!actions.length && !error && <p className="mt-2 text-sm">{t("No trackable actions available.")}</p>}
    <div className="mt-3 space-y-4">{actions.map(action => <ActionEditor key={`${reportId}:${action.key}`} action={action} canEdit={canEdit} url={`${apiBase}/api/insights/${reportId}/actions/${encodeURIComponent(action.key)}`} />)}</div>
  </section>;
}

function ActionEditor({ action, canEdit, url }: { action: Action; canEdit: boolean; url: string }) {
  const [value, setValue] = useState<Feedback>(action.feedback ?? { status: 'planned', effect: 'unknown', note: '' });
  const [message, setMessage] = useState(action.feedback ? 'Saved feedback' : 'Not yet reviewed');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(url, { method: 'PUT', headers: headers(), body: JSON.stringify({ status: value.status, effect: value.effect, note: value.note }) });
      if (!response.ok) throw new Error('Save failed. Your edits are retained; please retry.');
      const saved = await response.json() as Feedback;
      setValue(saved); setMessage('Feedback saved');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };
  return <article className="rounded-lg bg-paper-card p-3">
    <h4 className="text-sm font-semibold">{action.title}</h4>
    <fieldset disabled={!canEdit || busy} className="mt-2 space-y-2">
      <label className="block text-xs">{t("Action status")}<select aria-label={`Action status: ${action.title}`} className="ml-2 rounded border p-1" value={value.status} onChange={e => setValue({ ...value, status: e.target.value as Feedback['status'], effect: e.target.value === 'completed' ? value.effect : 'unknown' })}>{['planned', 'adopted', 'completed', 'dismissed'].map(status => <option key={status}>{status}</option>)}</select></label>
      <label className="block text-xs">{t("Observed effect")}<select aria-label={`Observed effect: ${action.title}`} className="ml-2 rounded border p-1" disabled={value.status !== 'completed'} value={value.effect} onChange={e => setValue({ ...value, effect: e.target.value as Feedback['effect'] })}>{['unknown', 'improved', 'unchanged', 'worse'].map(effect => <option key={effect}>{effect}</option>)}</select></label>
      <textarea aria-label={`Outcome notes: ${action.title}`} maxLength={2000} className="w-full rounded border p-2 text-sm" placeholder={t("What was done? What result did you observe?")} value={value.note} onChange={e => setValue({ ...value, note: e.target.value })} />
      <button type="button" onClick={save} className="rounded border px-3 py-1 text-sm" aria-label={`Save feedback: ${action.title}`}>{busy ? t("Saving…") : t("Save feedback")}</button>
    </fieldset>
    <p role="status" className="mt-1 text-xs text-ink-soft">{t(message)}</p>
  </article>;
}

export function ReportActionFeedback(props: {reportId:string;apiBase:string}) { return <ReportActionFeedbackContent key={`${props.apiBase}:${props.reportId}`} {...props} />; }
