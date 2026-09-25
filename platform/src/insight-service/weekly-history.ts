import { z } from 'zod';
import type { ActorContext } from '../contracts/domain';
import { INSIGHT_TEMPLATES, INSIGHT_TEMPLATE_LABELS, type InsightTemplate } from '../contracts/insights';
import type { Database, TenantTransaction } from '../foundation/database';
import { can } from '../foundation/rbac';
import { HttpError } from '../http/errors';
import { reportActions } from './feedback';

/**
 * Module 3 (历史周复盘): execution-time weekly statistics with immutable
 * snapshots. Unlike the live weekly review (current-state, rewritten by every
 * feedback edit), history reads immutable status-transition audit records.
 * Notes/effect edits cannot move a completion into a different week.
 */

export const WEEKLY_HISTORY_BASIS = 'status_transition_in_window' as const;
const SNAPSHOT_LIST_LIMIT = 12;
const REPORT_SCAN_LIMIT = 500;

/** UTC Monday 00:00 of the ISO week containing `instant`. */
export function isoWeekStart(instant: Date): Date {
  const day = instant.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate() - mondayOffset));
  return monday;
}

export function isoWeekEnd(start: Date): Date {
  return new Date(start.getTime() + 7 * 86_400_000);
}

const weekStartSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Not strict: saved entries also carry actorId, and future additive fields
// must not make historical feedback unattributable.
const executedFeedbackSchema = z.object({
  status: z.enum(['planned', 'adopted', 'completed', 'dismissed']),
  effect: z.enum(['unknown', 'improved', 'unchanged', 'worse']).default('unknown'),
  note: z.string().max(2000).default(''),
  updatedAt: z.string(),
});

export interface HistorySource {
  id: string; title: string; template: InsightTemplate; generatedAt: string;
  report: Record<string, unknown>; feedback: Record<string, unknown>;
}

export interface ExecutedAction {
  key: string; title: string; status: 'planned' | 'adopted' | 'completed' | 'dismissed';
  effect: 'unknown' | 'improved' | 'unchanged' | 'worse'; note: string; updatedAt: string;
}

export interface WeekExecution {
  basis?: string;
  weekStart: string; weekEnd: string;
  templates: Array<{
    template: InsightTemplate; label: string;
    counts: { events: number; planned: number; adopted: number; completed: number; dismissed: number };
    effects: { improved: number; unchanged: number; worse: number; unknown: number };
    knownEffects: number; adoptionRate: number | null; completionRate: number | null; improvementRate: number | null;
    reports: Array<{ id: string; title: string; generatedAt: string; actions: ExecutedAction[] }>;
  }>;
  totals: {
    events: number; planned: number; adopted: number; completed: number; dismissed: number;
    effects: { improved: number; unchanged: number; worse: number; unknown: number }; knownEffects: number;
    adoptionRate: number | null; completionRate: number | null; improvementRate: number | null;
  };
  completedActions: Array<ExecutedAction & { reportId: string; reportTitle: string; template: InsightTemplate }>;
}

type WeekTotals = WeekExecution['totals'];

function emptyEffects() { return { improved: 0, unchanged: 0, worse: 0, unknown: 0 }; }

function rates(counts: { events: number; adopted: number; completed: number }, effects: ReturnType<typeof emptyEffects>) {
  const knownEffects = effects.improved + effects.unchanged + effects.worse;
  return {
    knownEffects,
    adoptionRate: counts.events ? counts.adopted / counts.events : null,
    completionRate: counts.events ? counts.completed / counts.events : null,
    improvementRate: knownEffects ? effects.improved / knownEffects : null,
  };
}

/**
 * Attributes actions by the server audit timestamp supplied by loadWindowSources.
 * Entries without a parseable timestamp cannot be attributed honestly and
 * are skipped; keys not present in the immutable report body are ignored.
 */
export function computeWeekExecution(rows: HistorySource[], weekStart: Date): WeekExecution {
  const startMs = weekStart.getTime();
  const endMs = startMs + 7 * 86_400_000;
  const templates = INSIGHT_TEMPLATES.map(template => {
    const counts = { events: 0, planned: 0, adopted: 0, completed: 0, dismissed: 0 };
    const effects = emptyEffects();
    const reports: WeekExecution['templates'][number]['reports'] = [];
    for (const row of rows.filter(source => source.template === template)) {
      const actions: ExecutedAction[] = [];
      for (const action of reportActions(template, row.report)) {
        const raw = row.feedback[action.key] as Record<string, unknown> | undefined;
        const parsed = raw ? executedFeedbackSchema.safeParse(raw) : null;
        if (!parsed || !parsed.success) continue;
        const updatedMs = Date.parse(parsed.data.updatedAt);
        if (Number.isNaN(updatedMs) || updatedMs < startMs || updatedMs >= endMs) continue;
        counts.events += 1;
        if (parsed.data.status === 'planned') counts.planned += 1;
        if (parsed.data.status === 'dismissed') counts.dismissed += 1;
        if (parsed.data.status === 'adopted') counts.adopted += 1;
        if (parsed.data.status === 'completed') {
          counts.completed += 1;
          counts.adopted += 1; // adoption includes completion, same as the live review
          effects[parsed.data.effect] += 1;
        }
        actions.push({ key: action.key, title: action.title, ...parsed.data });
      }
      if (actions.length > 0) {
        actions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        reports.push({ id: row.id, title: row.title, generatedAt: row.generatedAt, actions });
      }
    }
    return { template, label: INSIGHT_TEMPLATE_LABELS[template].en, counts, effects, ...rates(counts, effects), reports };
  });
  const totals = templates.reduce<WeekTotals>((acc, group) => ({
    events: acc.events + group.counts.events,
    planned: acc.planned + group.counts.planned,
    adopted: acc.adopted + group.counts.adopted,
    completed: acc.completed + group.counts.completed,
    dismissed: acc.dismissed + group.counts.dismissed,
    effects: {
      improved: acc.effects.improved + group.effects.improved,
      unchanged: acc.effects.unchanged + group.effects.unchanged,
      worse: acc.effects.worse + group.effects.worse,
      unknown: acc.effects.unknown + group.effects.unknown,
    },
    knownEffects: 0, adoptionRate: null, completionRate: null, improvementRate: null,
  }), { events: 0, planned: 0, adopted: 0, completed: 0, dismissed: 0, effects: emptyEffects(), knownEffects: 0, adoptionRate: null, completionRate: null, improvementRate: null });
  Object.assign(totals, rates(totals, totals.effects));
  const completedActions = templates.flatMap(group => group.reports.flatMap(report =>
    report.actions.filter(action => action.status === 'completed')
      .map(action => ({ ...action, reportId: report.id, reportTitle: report.title, template: group.template }))));
  completedActions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    basis: WEEKLY_HISTORY_BASIS,
    weekStart: weekStart.toISOString(), weekEnd: isoWeekEnd(weekStart).toISOString(),
    templates, totals, completedActions,
  };
}

interface SnapshotRow {
  id: string; week_start: string; week_end: string; created_at: string; payload: WeekExecution;
}

function comparison(current: WeekTotals, previous: WeekTotals | null) {
  if (!previous) return null;
  const delta = (a: number | null, b: number | null) => (a === null || b === null) ? null : a - b;
  return {
    events: current.events - previous.events,
    completed: current.completed - previous.completed,
    adoptionRate: delta(current.adoptionRate, previous.adoptionRate),
    completionRate: delta(current.completionRate, previous.completionRate),
    improvementRate: delta(current.improvementRate, previous.improvementRate),
  };
}

async function loadWindowSources(tx: TenantTransaction, start: Date, end: Date): Promise<HistorySource[]> {
  const result = await tx.query<HistorySource>(
    `WITH transitions AS (
       SELECT DISTINCT ON (payload->>'reportId', payload->>'actionKey')
         payload->>'reportId' AS report_id, payload->>'actionKey' AS action_key,
         (payload->'feedback') || jsonb_build_object('updatedAt', created_at) AS feedback
       FROM audit_event
       WHERE workspace_id = current_setting('app.workspace_id')::uuid
         AND event_type = 'insight.action_feedback'
         AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
         AND payload->'feedback'->>'status' IN ('planned', 'adopted', 'completed', 'dismissed')
         AND (payload->'previous'->>'status') IS DISTINCT FROM (payload->'feedback'->>'status')
       ORDER BY payload->>'reportId', payload->>'actionKey', created_at DESC, id DESC
     ), per_report AS (
       SELECT report_id, jsonb_object_agg(action_key, feedback) AS feedback
       FROM transitions GROUP BY report_id
     )
     SELECT i.id, i.title, i.template, i.generated_at::text AS "generatedAt", i.report, e.feedback
       FROM insight_report i JOIN per_report e ON e.report_id = i.id::text
      WHERE i.workspace_id = current_setting('app.workspace_id')::uuid AND i.status = 'generated'
      ORDER BY i.created_at DESC, i.id DESC LIMIT ${REPORT_SCAN_LIMIT + 1}`,
    [start.toISOString(), end.toISOString()]);
  // Never silently omit reports while displaying apparently complete totals.
  if (result.rows.length > REPORT_SCAN_LIMIT) throw new HttpError(422, 'weekly_review_too_many_reports');
  return result.rows;
}

export class WeeklyHistoryService {
  constructor(private readonly database: Database) {}

  async history(actor: ActorContext, now = new Date()) {
    const currentStart = isoWeekStart(now);
    const currentEnd = isoWeekEnd(currentStart);
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const sources = await loadWindowSources(tx, currentStart, currentEnd);
      const current = computeWeekExecution(sources, currentStart);
      const snapshots = await tx.query<SnapshotRow>(
        `SELECT id, week_start::text AS "week_start", week_end::text AS "week_end",
                created_at::text AS "created_at", payload
           FROM weekly_review_snapshot
          WHERE workspace_id = current_setting('app.workspace_id')::uuid
          ORDER BY week_start DESC LIMIT ${SNAPSHOT_LIST_LIMIT + 1}`, []);
      const rows = snapshots.rows;
      const sealedCurrent = rows.some(row => row.week_start === currentStart.toISOString().slice(0, 10));
      const weeks = rows.map((row, index) => {
        const older = rows[index + 1];
        const consecutive = older && row.payload.basis === older.payload.basis && Date.parse(row.week_start) - Date.parse(older.week_start) === 7 * 86_400_000;
        return {
          weekStart: row.week_start, weekEnd: row.week_end, sealedAt: row.created_at,
          basis: row.payload.basis ?? 'feedback_updated_in_window',
          totals: row.payload.totals,
          comparison: consecutive ? comparison(row.payload.totals, older.payload.totals) : null,
        };
      });
      const latest = rows[0];
      const currentComparison = latest && latest.payload.basis === WEEKLY_HISTORY_BASIS && latest.week_end === current.weekStart.slice(0, 10)
        ? comparison(current.totals, latest.payload.totals) : null;
      return {
        basis: WEEKLY_HISTORY_BASIS,
        current: { ...current, sealed: sealedCurrent, comparison: currentComparison },
        weeks,
      };
    });
  }

  async snapshotDetail(actor: ActorContext, weekStartParam: unknown) {
    const weekStart = weekStartSchema.parse(weekStartParam);
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const result = await tx.query<SnapshotRow>(
        `SELECT id, week_start::text AS "week_start", week_end::text AS "week_end",
                created_at::text AS "created_at", payload
           FROM weekly_review_snapshot
          WHERE workspace_id = current_setting('app.workspace_id')::uuid AND week_start = $1::date`, [weekStart]);
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'weekly_review_snapshot_not_found');
      return { ...row.payload, basis: row.payload.basis ?? 'feedback_updated_in_window', weekStart: row.week_start, weekEnd: row.week_end, sealedAt: row.created_at };
    });
  }

  async seal(actor: ActorContext, body: unknown, now = new Date()) {
    if (!can(actor.role, 'workflow:run')) throw new HttpError(403, 'weekly_review_seal_forbidden');
    const input = z.object({ weekStart: weekStartSchema.optional() }).strict().parse(body ?? {});
    const requested = input.weekStart ? new Date(`${input.weekStart}T00:00:00.000Z`) : isoWeekStart(now);
    if (requested.getUTCDay() !== 1 || requested.getTime() !== isoWeekStart(requested).getTime()) {
      throw new HttpError(422, 'weekly_review_week_start_must_be_monday');
    }
    const currentStart = isoWeekStart(now);
    if (requested.getTime() > currentStart.getTime()) throw new HttpError(422, 'weekly_review_future_week');
    const end = isoWeekEnd(requested);
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const sources = await loadWindowSources(tx, requested, end);
      const execution = computeWeekExecution(sources, requested);
      const inserted = await tx.query<{ id: string; created_at: string }>(
        `INSERT INTO weekly_review_snapshot (workspace_id, week_start, week_end, payload, created_by)
         VALUES (current_setting('app.workspace_id')::uuid, $1::date, $2::date, $3::jsonb, $4)
         ON CONFLICT (workspace_id, week_start) DO NOTHING
         RETURNING id, created_at::text AS "created_at"`,
        [requested.toISOString().slice(0, 10), end.toISOString().slice(0, 10), JSON.stringify(execution), actor.actorId]);
      const row = inserted.rows[0];
      // Sealed history is immutable: an existing snapshot is never overwritten.
      if (!row) throw new HttpError(409, 'weekly_review_snapshot_exists');
      await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'weekly_review.snapshot_created', {
          snapshotId: row.id, weekStart: execution.weekStart, weekEnd: execution.weekEnd, totals: execution.totals,
        }]);
      return { weekStart: execution.weekStart, weekEnd: execution.weekEnd, sealedAt: row.created_at, totals: execution.totals };
    });
  }
}
