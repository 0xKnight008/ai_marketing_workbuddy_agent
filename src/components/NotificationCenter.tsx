import { t } from '../workspace/translate';
import { useState } from 'react';
import { readSessionAccessToken } from '../lib/auth-session';

interface ConnectedAccount { id: string; displayName: string; platform: string; capabilities: string[]; status: string }
interface Rule {
  id: string; kind: string; channel: 'email' | 'discord'; email: string | null;
  connectedAccountId: string | null; weeklyTemplate: string | null; weeklyDeliveryMode: 'approval' | 'auto' | null; updatedAt: string;
}
interface NotificationEvent {
  id: string; kind: string; status: string; channel: string; targetLabel: string; subject: string;
  error: string | null; reportId: string | null; createdAt: string; sentAt: string | null; actedAt: string | null;
}

const FLOWS: Array<{ kind: string; name: string; schedule: string; description: string }> = [
  { kind: 'morning_push', name: 'Morning push', schedule: 'every day after the 07:00 UTC daily-tasks report', description: 'The validated daily task digest, delivered automatically once the morning report is generated.' },
  { kind: 'evening_recap', name: 'Evening recap', schedule: 'every day at 20:00 UTC', description: 'Today’s recorded decisions — including completions of older suggestions — plus anything still unreviewed.' },
  { kind: 'weekly_report', name: 'Weekly report', schedule: 'every Monday 08:00 UTC', description: 'A weekly insight report is generated automatically. Approval mode freezes the digest until you click approve; auto mode delivers it directly.' },
  { kind: 'urgent_risk', name: 'Urgent risk alerts', schedule: 'immediately when a report flags a high-severity risk', description: 'Verbatim-evidence alerts from validated reports. Close the loop in the console: acknowledge, then resolve.' },
];

const headers = () => ({ Authorization: `Bearer ${readSessionAccessToken()}` });
const dayTime = (iso: string | null) => iso ? iso.slice(0, 16).replace('T', ' ') : '—';

function RuleEditor({ flow, rule, accounts, apiBase, onSaved, onError }: {
  flow: (typeof FLOWS)[number]; rule: Rule | null; accounts: ConnectedAccount[]; apiBase: string;
  onSaved: () => void; onError: (message: string) => void;
}) {
  const discordAccounts = accounts.filter(account => account.platform === 'discord' && account.status === 'connected' && account.capabilities.includes('publish'));
  const [channel, setChannel] = useState<'email' | 'discord'>(rule?.channel ?? 'email');
  const [email, setEmail] = useState(rule?.email ?? '');
  const [accountId, setAccountId] = useState(rule?.connectedAccountId ?? discordAccounts[0]?.id ?? '');
  const [weeklyTemplate, setWeeklyTemplate] = useState(rule?.weeklyTemplate ?? 'content_recap');
  const [weeklyMode, setWeeklyMode] = useState<'approval' | 'auto'>(rule?.weeklyDeliveryMode ?? 'approval');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const save = async () => {
    setBusy(true); onError('');
    try {
      const body: Record<string, unknown> = { channel };
      if (channel === 'email' && email.trim()) body.email = email.trim();
      if (channel === 'discord') body.connectedAccountId = accountId;
      if (flow.kind === 'weekly_report') { body.weeklyTemplate = weeklyTemplate; body.weeklyDeliveryMode = weeklyMode; }
      const response = await fetch(`${apiBase}/api/notifications/rules/${flow.kind}`, { method: 'PUT', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error === 'notification_target_invalid' ? 'Choose a connected Discord account with publish capability.' : `Unable to save the rule (${response.status}).`);
      }
      setOpen(false); onSaved();
    } catch (e) { onError(e instanceof Error ? e.message : 'Unable to save the rule'); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true); onError('');
    try {
      const response = await fetch(`${apiBase}/api/notifications/rules/${flow.kind}`, { method: 'DELETE', headers: headers() });
      if (!response.ok) throw new Error('Unable to disable the rule.');
      setOpen(false); onSaved();
    } catch (e) { onError(e instanceof Error ? e.message : 'Unable to disable the rule'); }
    finally { setBusy(false); }
  };

  return <article className="rounded-xl border border-ink/15 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-lg font-semibold">{t(flow.name)}</h3>
      {rule
        ? <span className="rounded bg-meadow/20 px-2 py-0.5 text-xs">{t("on ·")} {rule.channel}{rule.kind === 'weekly_report' ? ` · ${rule.weeklyDeliveryMode}` : ''}</span>
        : <span className="rounded bg-ink/10 px-2 py-0.5 text-xs">{t("off")}</span>}
      <button type="button" onClick={() => setOpen(value => !value)} className="ml-auto rounded border px-3 py-1 text-xs">{open ? t("Close") : rule ? t("Edit") : t("Enable")}</button>
    </div>
    <p className="mt-1 text-xs text-ink-soft">{t("Runs")} {t(flow.schedule)}. {t(flow.description)}</p>
    {open && <div className="mt-3 space-y-2 rounded-lg bg-paper p-3">
      <div className="flex flex-wrap gap-2">
        {(['email', 'discord'] as const).map(option => <button key={option} type="button" onClick={() => setChannel(option)} aria-pressed={channel === option} className={`rounded border px-3 py-1 text-sm ${channel === option ? t("bg-sky-deep text-white") : ''}`}>{option}</button>)}
      </div>
      {channel === 'email' && <input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder={t("Recipient email (blank = workspace owner)")} className="w-full rounded border border-ink/20 bg-paper-card px-3 py-2 text-sm" />}
      {channel === 'discord' && (discordAccounts.length === 0
        ? <p className="text-xs text-ink-soft">{t("No connected Discord account with publish capability — connect one under Accounts first.")}</p>
        : <select value={accountId} onChange={event => setAccountId(event.target.value)} className="w-full rounded border border-ink/20 bg-paper-card px-3 py-2 text-sm">{discordAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select>)}
      {flow.kind === 'weekly_report' && <div className="flex flex-wrap gap-2">
        <select value={weeklyTemplate} onChange={event => setWeeklyTemplate(event.target.value)} className="rounded border border-ink/20 bg-paper-card px-3 py-2 text-sm">
          <option value="content_recap">{t("Content recap")}</option><option value="comment_insights">{t("Comment insights")}</option><option value="product_opportunities">{t("Product opportunities")}</option><option value="review_attribution">{t("Review attribution")}</option><option value="community_digest">{t("Community digest")}</option>
        </select>
        <select value={weeklyMode} onChange={event => setWeeklyMode(event.target.value as 'approval' | 'auto')} className="rounded border border-ink/20 bg-paper-card px-3 py-2 text-sm">
          <option value="approval">{t("approval — I release each digest")}</option><option value="auto">{t("auto — deliver directly")}</option>
        </select>
      </div>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || (channel === 'discord' && !accountId)} onClick={() => void save()} className="rounded bg-sky-deep px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? t("Saving…") : t("Save rule")}</button>
        {rule && <button type="button" disabled={busy} onClick={() => void disable()} className="rounded border px-4 py-2 text-sm">{t("Disable")}</button>}
      </div>
      <p className="text-xs text-ink-soft">{t("Saving this rule is your standing approval for this recurring delivery. Report content is platform-validated; suggested outbound actions inside reports still need per-action approval.")}</p>
    </div>}
  </article>;
}

export function NotificationCenter({ apiBase: base, accounts }: { apiBase: string; accounts: ConnectedAccount[] }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [events, setEvents] = useState<NotificationEvent[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true); setError('');
    try {
      const [rulesResponse, eventsResponse] = await Promise.all([
        fetch(`${base}/api/notifications/rules`, { headers: headers() }),
        fetch(`${base}/api/notifications/events`, { headers: headers() }),
      ]);
      if (!rulesResponse.ok || !eventsResponse.ok) throw new Error('Unable to load notifications. Please retry.');
      const rulesData = await rulesResponse.json() as { rules: Rule[] };
      const eventsData = await eventsResponse.json() as { events: NotificationEvent[] };
      if (!Array.isArray(rulesData.rules) || !Array.isArray(eventsData.events)) throw new Error('Invalid notifications response.');
      setRules(rulesData.rules); setEvents(eventsData.events);
    } catch (e) { setRules(null); setEvents(null); setError(e instanceof Error ? e.message : 'Unable to load notifications'); }
    finally { setBusy(false); }
  };

  const act = async (eventId: string, action: 'approve' | 'acknowledge' | 'resolve') => {
    setError('');
    const path = action === 'approve' ? 'approve' : 'act';
    const response = await fetch(`${base}/api/notifications/events/${eventId}/${path}`, { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: action === 'approve' ? '{}' : JSON.stringify({ action }) });
    if (!response.ok) { setError(response.status === 409 ? 'This event was already handled. Refreshing.' : 'Action failed. Please retry.'); }
    await load();
  };

  const loaded = rules !== null && events !== null;
  return <section aria-label={t("Scheduled delivery")} className="sketch bg-paper-card p-6 shadow-paint-sm">
    <h2 className="font-display text-3xl">{t("Scheduled delivery")}</h2>
    <p className="mt-2 text-sm text-ink-soft">{t("The daily operations loop, delivered: morning task push, evening recap, weekly report generation with approval delivery, and urgent risk alerts. Times are UTC. Enabling a flow is your standing approval for that recurring delivery; AI-suggested outbound actions stay per-action approval-gated.")}</p>
    <button type="button" disabled={busy} onClick={load} className="mt-3 rounded border px-4 py-2 text-sm">{busy ? t("Loading…") : loaded ? t("Refresh scheduled delivery") : t("Load scheduled delivery")}</button>
    {error && <p role="alert" className="mt-3 text-sm">{t(error)}</p>}
    {loaded && <div className="mt-4 space-y-4">
      <div className="space-y-3">
        {FLOWS.map(flow => <RuleEditor key={flow.kind} flow={flow} rule={rules.find(rule => rule.kind === flow.kind) ?? null} accounts={accounts} apiBase={base} onSaved={() => void load()} onError={setError} />)}
      </div>
      <article className="rounded-xl border border-ink/15 p-4">
        <h3 className="text-lg font-semibold">{t("Delivery events")}</h3>
        {events.length === 0 && <p className="mt-2 text-sm text-ink-soft">{t("No events yet. They appear as scheduled flows run.")}</p>}
        <ul className="mt-2 space-y-2">{events.map(event => <li key={event.id} className="rounded border border-ink/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs ${event.status === 'failed' ? 'bg-sunset/20' : event.status === 'pending_approval' ? 'bg-sun/30' : event.status === 'sent' ? 'bg-meadow/20' : 'bg-ink/10'}`}>{event.status}</span>
            <span className="text-xs text-ink-soft">{event.kind} · {event.channel} → {event.targetLabel}</span>
            <span className="ml-auto text-xs text-ink-soft">{dayTime(event.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm">{event.subject}</p>
          {event.error && <p className="mt-1 text-xs text-sunset-deep">{t("Error:")} {event.error}</p>}
          <div className="mt-2 flex gap-2">
            {event.kind === 'weekly_report' && event.status === 'pending_approval' && <button type="button" onClick={() => void act(event.id, 'approve')} className="rounded bg-sky-deep px-3 py-1 text-xs font-bold text-white">{t("Approve delivery")}</button>}
            {event.kind === 'urgent_risk' && event.status === 'sent' && <button type="button" onClick={() => void act(event.id, 'acknowledge')} className="rounded border px-3 py-1 text-xs">{t("Acknowledge")}</button>}
            {event.kind === 'urgent_risk' && (event.status === 'sent' || event.status === 'acknowledged') && <button type="button" onClick={() => void act(event.id, 'resolve')} className="rounded border px-3 py-1 text-xs">{t("Resolve")}</button>}
          </div>
        </li>)}</ul>
      </article>
    </div>}
  </section>;
}
