import { t } from '../workspace/translate';
import { useState } from 'react';
import { readSessionAccessToken } from '../lib/auth-session';

interface Totals {
  events: number; planned: number; adopted: number; completed: number; dismissed: number;
  effects: { improved: number; unchanged: number; worse: number; unknown: number }; knownEffects: number;
  adoptionRate: number | null; completionRate: number | null; improvementRate: number | null;
}
interface Comparison { events: number; completed: number; adoptionRate: number | null; completionRate: number | null; improvementRate: number | null }
interface CompletedAction { key: string; title: string; status: string; effect: string; note: string; updatedAt: string; reportId: string; reportTitle: string; template: string }
interface WeekExecution {
  weekStart: string; weekEnd: string; totals: Totals; completedActions: CompletedAction[];
  templates: Array<{ template: string; label: string; counts: { events: number; planned: number; adopted: number; completed: number; dismissed: number }; knownEffects: number; adoptionRate: number | null; completionRate: number | null; improvementRate: number | null; reports: Array<{ id: string; title: string; generatedAt: string; actions: Array<{ key: string; title: string; status: string; effect: string; note: string; updatedAt: string }> }> }>;
}
interface History {
  basis: string;
  current: WeekExecution & { sealed: boolean; comparison: Comparison | null };
  weeks: Array<{ weekStart: string; weekEnd: string; sealedAt: string; totals: Totals; comparison: Comparison | null }>;
}

const percent = (rate: number | null) => rate === null ? 'N/A' : `${(rate * 100).toFixed(1)}%`;
const signed = (value: number) => value > 0 ? `+${value}` : `${value}`;
const rateDelta = (value: number | null) => value === null ? 'N/A' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`;
const day = (iso: string) => iso.slice(0, 10);

function TotalsLine({ totals }: { totals: Totals }) {
  return <>
    <p className="mt-1 text-sm">{totals.events} {t("decisions recorded ·")} {totals.planned} {t("planned ·")} {totals.dismissed} {t("dismissed")}</p>
    <p className="mt-1 text-sm">{t("Adopted:")} {totals.adopted}/{totals.events} ({percent(totals.adoptionRate)}{t(") · Completed:")} {totals.completed}/{totals.events} ({percent(totals.completionRate)})</p>
    <p className="mt-1 text-sm">{t("Improved:")} {totals.effects.improved}/{totals.knownEffects} ({percent(totals.improvementRate)}{t(") · Unchanged:")} {totals.effects.unchanged} {t("· Worse:")} {totals.effects.worse} {t("· Completed, effect unknown:")} {totals.effects.unknown}</p>
  </>;
}

function ComparisonLine({ comparison }: { comparison: Comparison | null }) {
  if (!comparison) return <p className="mt-1 text-xs text-ink-soft">{t("No consecutive sealed week to compare with.")}</p>;
  return <p className="mt-1 text-xs text-ink-soft">{t("vs previous week — decisions:")} {signed(comparison.events)} {t("· completed:")} {signed(comparison.completed)} {t("· adoption:")} {rateDelta(comparison.adoptionRate)} {t("· completion:")} {rateDelta(comparison.completionRate)} {t("· improvement:")} {rateDelta(comparison.improvementRate)}</p>;
}

function CompletedList({ actions, onOpenReport }: { actions: CompletedAction[]; onOpenReport: (id: string) => void }) {
  if (actions.length === 0) return <p className="mt-2 text-xs text-ink-soft">{t("No actions were marked completed in this window.")}</p>;
  return <ul className="mt-2 space-y-2">{actions.map(action => <li key={`${action.reportId}:${action.key}`} className="rounded border border-ink/10 p-2 text-sm">
    <p>{action.title} {t("· effect:")} {action.effect}</p>
    <p className="text-xs text-ink-soft">{t("From report “")}{action.reportTitle}{t("” · completed")} {day(action.updatedAt)}{action.note ? ` · Observation: ${action.note}` : ''}</p>
    <button type="button" onClick={() => onOpenReport(action.reportId)} className="mt-1 rounded border px-2 py-0.5 text-xs">{t("Open report")}</button>
  </li>)}</ul>;
}

export function WeeklyHistory({ apiBase, onOpenReport }: { apiBase: string; onOpenReport: (id: string) => void }) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [notice, setNotice] = useState('');
  const [details, setDetails] = useState<Record<string, WeekExecution | 'loading'>>({});

  const headers = () => ({ Authorization: `Bearer ${readSessionAccessToken()}` });
  const load = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBase}/api/insights/weekly-history`, { headers: headers() });
      if (!response.ok) throw new Error(response.status === 422 ? 'This window contains too many reports; no partial totals are shown.' : 'Unable to load weekly history. Please retry.');
      const data = await response.json() as History;
      if (!data.current || !Array.isArray(data.weeks) || typeof data.current.weekStart !== 'string') throw new Error('Invalid weekly history response.');
      setHistory(data); setDetails({});
    } catch (e) { setHistory(null); setError(e instanceof Error ? e.message : 'Unable to load weekly history'); }
    finally { setBusy(false); }
  };
  const seal = async () => {
    setSealing(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${apiBase}/api/insights/weekly-history/snapshots`, { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: '{}' });
      if (response.status === 409) { setNotice('This week is already sealed. Sealed snapshots never change.'); await load(); return; }
      if (!response.ok) throw new Error('Unable to seal this week. Please retry.');
      setNotice('Week sealed. This snapshot is now immutable and available for cross-week comparison.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to seal this week'); }
    finally { setSealing(false); }
  };
  const toggleDetail = async (weekStart: string) => {
    if (details[weekStart]) { setDetails(current => { const next = { ...current }; delete next[weekStart]; return next; }); return; }
    setDetails(previous => ({ ...previous, [weekStart]: 'loading' }));
    try {
      const response = await fetch(`${apiBase}/api/insights/weekly-history/${weekStart}`, { headers: headers() });
      if (!response.ok) throw new Error('Unable to load the sealed snapshot.');
      const data = await response.json() as WeekExecution;
      setDetails(previous => ({ ...previous, [weekStart]: data }));
    } catch {
      setDetails(previous => { const next = { ...previous }; delete next[weekStart]; return next; });
      setError('Unable to load the sealed snapshot. Please retry.');
    }
  };

  return <section aria-label={t("Weekly execution history")} className="sketch bg-paper-card p-6 shadow-paint-sm">
    <h2 className="font-display text-3xl">{t("Weekly execution history")}</h2>
    <p className="mt-2 text-sm text-ink-soft">{t("Weekly counts use recorded status changes (UTC, Monday-start), not later note or effect edits. Each action uses its last status change within that week. Effects reflect what was recorded at that transition. Older sealed snapshots keep their original basis; different bases are not compared. No AI credits or outbound messages are used.")}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={load} className="rounded border px-4 py-2 text-sm">{busy ? t("Loading history…") : history ? t("Refresh weekly history") : t("Load weekly history")}</button>
      {history && !history.current.sealed && <button type="button" disabled={sealing} onClick={seal} className="rounded bg-sky-deep px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{sealing ? t("Sealing…") : t("Seal this week")}</button>}
    </div>
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="mt-3 text-sm">{t(error)}</p>}
    {history && <div className="mt-4 space-y-4">
      <article className="rounded-xl border border-ink/15 p-4">
        <h3 className="text-lg font-semibold">{t("This week ·")} {day(history.current.weekStart)} → {day(history.current.weekEnd)} {history.current.sealed && <span className="ml-2 rounded bg-meadow/20 px-2 py-0.5 text-xs">{t("sealed")}</span>}</h3>
        <TotalsLine totals={history.current.totals} />
        <ComparisonLine comparison={history.current.comparison} />
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">{t("Completed this week (")}{history.current.completedActions.length})</summary>
          <CompletedList actions={history.current.completedActions} onOpenReport={onOpenReport} />
        </details>
      </article>
      {history.weeks.length > 0 && <article className="rounded-xl border border-ink/15 p-4">
        <h3 className="text-lg font-semibold">{t("Sealed weeks")}</h3>
        <ul className="mt-2 space-y-2">{history.weeks.map(week => <li key={week.weekStart} className="rounded border border-ink/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{week.weekStart} → {week.weekEnd}</p>
            <span className="text-xs text-ink-soft">{t("sealed")} {day(week.sealedAt)}</span>
            <button type="button" onClick={() => void toggleDetail(week.weekStart)} className="ml-auto rounded border px-2 py-0.5 text-xs">{details[week.weekStart] ? t("Hide detail") : t("Show detail")}</button>
          </div>
          <TotalsLine totals={week.totals} />
          <ComparisonLine comparison={week.comparison} />
          {details[week.weekStart] === 'loading' && <p className="mt-2 text-xs text-ink-soft">{t("Loading sealed snapshot…")}</p>}
          {details[week.weekStart] && details[week.weekStart] !== 'loading' && (() => { const detail = details[week.weekStart] as WeekExecution; return <div className="mt-3 space-y-2">
            {detail.templates.filter(group => group.counts.events > 0).map(group => <p key={group.template} className="text-xs text-ink-soft">{group.label}: {group.counts.events} {t("decisions ·")} {group.counts.completed} {t("completed · improved")} {percent(group.improvementRate)}</p>)}
            <p className="text-sm font-semibold">{t("Completed that week (")}{detail.completedActions.length})</p>
            <CompletedList actions={detail.completedActions} onOpenReport={onOpenReport} />
          </div>; })()}
        </li>)}</ul>
      </article>}
    </div>}
  </section>;
}
