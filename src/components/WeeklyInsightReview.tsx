import { useState } from 'react';
import { readSessionAccessToken } from '../lib/auth-session';

interface Review {
  start: string; end: string;
  templates: Array<{
    template: string; label: string;
    counts: { actions: number; reviewed: number; planned: number; adopted: number; completed: number; dismissed: number; unreviewed: number };
    effects: { improved: number; unchanged: number; worse: number; unknown: number };
    knownEffects: number; adoptionRate: number | null; completionRate: number | null; improvementRate: number | null;
    reports: Array<{ id: string; title: string; summary: string; actions: Array<{ key: string; title: string; status: string; effect: string; note: string }> }>;
  }>;
}
const percent = (rate: number | null) => rate === null ? 'N/A' : `${(rate * 100).toFixed(1)}%`;

export function WeeklyInsightReview({ apiBase, onOpenReport }: { apiBase: string; onOpenReport: (id: string) => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBase}/api/insights/weekly-review`, { headers: { Authorization: `Bearer ${readSessionAccessToken()}` } });
      if (!response.ok) throw new Error(response.status === 422 ? 'This window contains too many reports; no partial totals are shown.' : 'Unable to load weekly review. Please retry.');
      const data = await response.json() as Review;
      if (!Array.isArray(data.templates) || typeof data.start !== 'string' || typeof data.end !== 'string') throw new Error('Invalid weekly review response.');
      setReview(data);
    } catch (e) { setReview(null); setError(e instanceof Error ? e.message : 'Unable to load review'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Weekly follow-up review" className="sketch bg-paper-card p-6 shadow-paint-sm">
    <h2 className="font-display text-3xl">Weekly follow-up review</h2>
    <p className="mt-2 text-sm text-ink-soft">Reports generated in the last 7 days, with their current manual feedback. This is not a historical snapshot or a count of all work completed this week. No AI credits or outbound messages are used.</p>
    <button type="button" disabled={busy} onClick={load} className="mt-3 rounded border px-4 py-2 text-sm">{busy ? 'Loading review…' : review ? 'Refresh weekly review' : 'Load weekly review'}</button>
    {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
    {review && <div className="mt-4 space-y-4">
      <p className="text-xs text-ink-soft">UTC generation window: {review.start} (inclusive) → {review.end} (exclusive). Refresh after recording feedback.</p>
      <p className="text-xs text-ink-soft">Adoption includes completed actions. Adoption and completion use all tracked suggestions, including unreviewed ones. Improvement uses only completed actions with a known, self-reported effect; N/A means no denominator.</p>
      {review.templates.map(group => <article key={group.template} className="rounded-xl border border-ink/15 p-4">
        <h3 className="text-lg font-semibold">{group.label}</h3>
        <p className="mt-2 text-sm">{group.reports.length} reports · {group.counts.actions} suggestions · {group.counts.unreviewed} unreviewed · {group.counts.planned} planned · {group.counts.dismissed} dismissed</p>
        <p className="mt-1 text-sm">Adopted: {group.counts.adopted}/{group.counts.actions} ({percent(group.adoptionRate)}) · Completed: {group.counts.completed}/{group.counts.actions} ({percent(group.completionRate)})</p>
        <p className="mt-1 text-sm">Improved: {group.effects.improved}/{group.knownEffects} ({percent(group.improvementRate)}) · Unchanged: {group.effects.unchanged} · Worse: {group.effects.worse} · Completed, effect unknown: {group.effects.unknown}</p>
        {group.counts.unreviewed > 0 && <p className="mt-2 text-xs">Next: review the unreviewed suggestions and record your decision.</p>}
        {group.effects.unknown > 0 && <p className="mt-2 text-xs">Next: record observed results when available; unknown does not mean no improvement.</p>}
        {group.reports.map(report => <details key={report.id} className="mt-3 rounded border border-ink/10 p-3">
          <summary className="cursor-pointer text-sm font-semibold">{report.title}</summary>
          <p className="mt-2 text-xs text-ink-soft">Findings — saved report summary, not newly verified:</p><p className="mt-1 text-sm">{report.summary}</p>
          <ul className="mt-3 space-y-2">{report.actions.map(action => <li key={action.key} className="text-sm"><p>{action.title} · {action.status} · effect: {action.effect}</p>{action.note && <p className="text-xs text-ink-soft">Observation: {action.note}</p>}</li>)}</ul>
          <button type="button" onClick={() => onOpenReport(report.id)} className="mt-3 rounded border px-3 py-1 text-sm">Open report and update feedback</button>
        </details>)}
      </article>)}
    </div>}
  </section>;
}
