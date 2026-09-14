import { z } from 'zod';
import type { ActorContext } from '../contracts/domain';
import type { Database } from '../foundation/database';
import { can } from '../foundation/rbac';
import { HttpError } from '../http/errors';
import type { InsightTemplate } from '../contracts/insights';

export const feedbackSchema = z.object({
  status: z.enum(['planned', 'adopted', 'completed', 'dismissed']),
  effect: z.enum(['unknown', 'improved', 'unchanged', 'worse']).default('unknown'),
  note: z.string().trim().max(2000).default(''),
}).strict().refine(value => value.status === 'completed' || value.effect === 'unknown', { message: 'effect_requires_completed_action' });

const sections: Record<InsightTemplate, Array<[string, string | null]>> = {
  content_recap: [['nextTopics', null], ['draftScripts', 'title']],
  comment_insights: [['highValueComments', 'replyDraft'], ['productOpportunities', 'opportunity']],
  product_opportunities: [['opportunities', 'validationAction']],
  review_attribution: [['priorityFixes', 'fix'], ['serviceReplyDrafts', 'replyDraft']],
  community_digest: [['activityIdeas', null], ['unresolvedQuestions', 'question']],
  daily_ops: [['tasks', 'title']],
};

/** Keys refer only to immutable, server-saved report output, never client text. */
export function reportActions(template: InsightTemplate, report: Record<string, unknown>) {
  return (sections[template] ?? []).flatMap(([section, field]) => {
    const entries = Array.isArray(report[section]) ? report[section] as unknown[] : [];
    return entries.flatMap((entry, index) => {
      const title = field && entry && typeof entry === 'object' ? (entry as Record<string, unknown>)[field] : entry;
      return typeof title === 'string' && title.trim() ? [{ key: `${section}:${index}`, title: title.trim().slice(0, 600) }] : [];
    });
  });
}

type SavedReport = { template: InsightTemplate; report: Record<string, unknown>; feedback: Record<string, unknown> };
export class InsightFeedbackService {
  constructor(private readonly database: Database) {}

  async list(actor: ActorContext, reportId: unknown) {
    const id = z.string().uuid().parse(reportId);
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const result = await tx.query<SavedReport>(
        `SELECT template, report, action_feedback AS feedback FROM insight_report
         WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generated'`, [id]);
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'insight_not_found');
      return { canEdit: can(actor.role, 'workflow:run'), actions: reportActions(row.template, row.report).map(action => ({ ...action, feedback: row.feedback[action.key] ?? null })) };
    });
  }

  async save(actor: ActorContext, reportId: unknown, actionKey: unknown, body: unknown) {
    if (!can(actor.role, 'workflow:run')) throw new HttpError(403, 'feedback_forbidden');
    const id = z.string().uuid().parse(reportId);
    const key = z.string().max(80).parse(actionKey);
    const input = feedbackSchema.parse(body);
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const result = await tx.query<SavedReport>(
        `SELECT template, report, action_feedback AS feedback FROM insight_report
         WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generated' FOR UPDATE`, [id]);
      const row = result.rows[0];
      if (!row) throw new HttpError(404, 'insight_not_found');
      const action = reportActions(row.template, row.report).find(item => item.key === key);
      if (!action) throw new HttpError(422, 'unknown_report_action');
      const previous = row.feedback[key] as Record<string, unknown> | undefined;
      // Identical retries are no-ops: no duplicate adoption/completion events.
      if (previous && previous.status === input.status && previous.effect === input.effect && previous.note === input.note) return previous;
      const feedback = { ...input, actorId: actor.actorId, updatedAt: new Date().toISOString() };
      await tx.query(
        `UPDATE insight_report SET action_feedback = action_feedback || $2::jsonb
         WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`, [id, JSON.stringify({ [key]: feedback })]);
      await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'insight.action_feedback', { reportId: id, template: row.template, actionKey: key, title: action.title, previous: previous ?? null, feedback, source: 'manual' }]);
      return feedback;
    });
  }
}
