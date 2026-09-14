import type { ActorContext } from '../contracts/domain';
import { INSIGHT_TEMPLATES, INSIGHT_TEMPLATE_LABELS, type InsightTemplate } from '../contracts/insights';
import type { Database } from '../foundation/database';
import { HttpError } from '../http/errors';
import { feedbackSchema, reportActions } from './feedback';

export interface WeeklySource {
  id: string; title: string; template: InsightTemplate; generatedAt: string;
  report: Record<string, unknown>; feedback: Record<string, unknown>;
}

/** Current-state cohort review, not historical event counts or causal impact. */
export function summarizeWeeklySources(rows: WeeklySource[]) {
  return INSIGHT_TEMPLATES.map(template => {
    const counts = { actions: 0, reviewed: 0, planned: 0, adopted: 0, completed: 0, dismissed: 0, unreviewed: 0 };
    const effects = { improved: 0, unchanged: 0, worse: 0, unknown: 0 };
    const reports = rows.filter(row => row.template === template).map(row => ({
      id: row.id, title: row.title, generatedAt: row.generatedAt,
      summary: typeof row.report.summary === 'string' ? row.report.summary.slice(0, 2000) : '',
      actions: reportActions(template, row.report).map(action => {
        counts.actions += 1;
        const raw = row.feedback[action.key] as Record<string, unknown> | undefined;
        const parsed = raw && feedbackSchema.safeParse({ status: raw.status, effect: raw.effect, note: raw.note });
        if (!parsed || !parsed.success) {
          counts.unreviewed += 1;
          return { ...action, status: 'unreviewed' as const, effect: 'unknown' as const, note: '' };
        }
        const feedback = parsed.data;
        counts.reviewed += 1;
        if (feedback.status === 'adopted' || feedback.status === 'completed') counts.adopted += 1;
        if (feedback.status === 'completed') { counts.completed += 1; effects[feedback.effect] += 1; }
        if (feedback.status === 'planned') counts.planned += 1;
        if (feedback.status === 'dismissed') counts.dismissed += 1;
        return { ...action, ...feedback };
      }),
    }));
    const knownEffects = effects.improved + effects.unchanged + effects.worse;
    return {
      template, label: INSIGHT_TEMPLATE_LABELS[template].en, reports, counts, effects, knownEffects,
      adoptionRate: counts.actions ? counts.adopted / counts.actions : null,
      completionRate: counts.actions ? counts.completed / counts.actions : null,
      improvementRate: knownEffects ? effects.improved / knownEffects : null,
    };
  });
}

export class WeeklyReviewService {
  constructor(private readonly database: Database) {}
  async review(actor: ActorContext, now = new Date()) {
    const end = now.toISOString();
    const start = new Date(now.getTime() - 7 * 86400_000).toISOString();
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const result = await tx.query<WeeklySource>(
        `SELECT id, title, template, generated_at::text AS "generatedAt", report, action_feedback AS feedback
           FROM insight_report
          WHERE workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generated'
            AND generated_at >= $1::timestamptz AND generated_at < $2::timestamptz
          ORDER BY generated_at DESC, id DESC LIMIT 501`, [start, end]);
      // Never silently omit reports while displaying apparently complete rates.
      if (result.rows.length > 500) throw new HttpError(422, 'weekly_review_too_many_reports');
      return { start, end, basis: 'reports_generated_in_window_current_feedback', templates: summarizeWeeklySources(result.rows) };
    });
  }
}
