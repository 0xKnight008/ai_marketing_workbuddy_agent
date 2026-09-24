import { z } from 'zod';
import type { ActorContext } from '../contracts/domain';
import { INSIGHT_TEMPLATES, INSIGHT_TEMPLATE_LABELS, type InsightTemplate } from '../contracts/insights';
import type { Database, TenantTransaction } from '../foundation/database';
import { requirePermission } from '../foundation/rbac';
import { HttpError } from '../http/errors';
import { renderReportDigest } from './delivery';
import { detectUrgentRisks, renderEveningRecap, renderUrgentAlert, renderWeeklyReady } from './notification-content';
import { reportActions } from './feedback';
import { isoWeekStart } from './weekly-history';
import { notificationContentError } from './notification-limits';

/**
 * Module 4 (定时运营交付闭环): standing-delivery rules and the notification
 * event loop. Enabling a rule is the workspace's standing approval for that
 * recurring flow; every send is a dedup-keyed notification_event so schedule
 * overlaps and retries never double-deliver. Weekly reports default to
 * approval mode (a human click releases the frozen digest). Urgent-risk
 * alerts close the loop in the console: sent → acknowledged → resolved.
 */

export const NOTIFICATION_KINDS = ['morning_push', 'evening_recap', 'weekly_report', 'urgent_risk'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
const WEEKLY_TEMPLATES = INSIGHT_TEMPLATES.filter(template => template !== 'daily_ops');

const kindSchema = z.enum(NOTIFICATION_KINDS);
const ruleInputSchema = z.object({
  channel: z.enum(['email', 'discord']),
  email: z.string().trim().email().max(320).optional(),
  connectedAccountId: z.string().uuid().optional(),
  weeklyTemplate: z.enum(WEEKLY_TEMPLATES as [InsightTemplate, ...InsightTemplate[]]).optional(),
  weeklyDeliveryMode: z.enum(['approval', 'auto']).optional(),
}).strict();

interface RuleRow {
  id: string; kind: NotificationKind; channel: 'email' | 'discord';
  email: string | null; connected_account_id: string | null;
  weekly_template: InsightTemplate | null; weekly_delivery_mode: 'approval' | 'auto' | null;
  created_at: string; updated_at: string;
}

interface ResolvedTarget { ok: true; target: string; targetLabel: string }
interface TargetError { ok: false; error: string }

/** Email defaults to the workspace owner; Discord reuses the delivery-time validation posture. */
async function resolveTarget(tx: TenantTransaction, rule: Pick<RuleRow, 'channel' | 'email' | 'connected_account_id'>): Promise<ResolvedTarget | TargetError> {
  if (rule.channel === 'email') {
    if (rule.email) return { ok: true, target: rule.email, targetLabel: rule.email };
    const owner = await tx.query<{ email: string }>(
      `SELECT u.email::text AS email
         FROM workspace_membership m JOIN app_user u ON u.id = m.user_id
        WHERE m.workspace_id = current_setting('app.workspace_id')::uuid AND m.role = 'owner'
        ORDER BY m.created_at ASC LIMIT 1`, []);
    const email = owner.rows[0]?.email;
    return email ? { ok: true, target: email, targetLabel: email } : { ok: false, error: 'notification_target_missing' };
  }
  if (!rule.connected_account_id) return { ok: false, error: 'notification_target_missing' };
  const account = await tx.query<{ displayName: string; status: string; platform: string; capabilities: string[] }>(
    `SELECT display_name AS "displayName", status, platform, capabilities
       FROM connected_account
      WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND provider = 'zernio'`,
    [rule.connected_account_id]);
  const connected = account.rows[0];
  if (!connected || connected.platform !== 'discord' || connected.status !== 'connected' || !connected.capabilities.includes('publish')) {
    return { ok: false, error: 'notification_target_invalid' };
  }
  return { ok: true, target: rule.connected_account_id, targetLabel: connected.displayName };
}

/** Inserts one dedup-keyed event; returns the new event id or null on conflict. */
async function insertEvent(tx: TenantTransaction, input: {
  kind: string; status: 'pending_approval' | 'queued' | 'failed'; dedupKey: string;
  channel: string; target: string; targetLabel: string; subject: string; content: string;
  reportId?: string; payload?: Record<string, unknown>; error?: string;
}): Promise<string | null> {
  const contentError = notificationContentError(input.channel, input.content);
  const result = await tx.query<{ id: string }>(
    `INSERT INTO notification_event (workspace_id, kind, status, dedup_key, channel, target, target_label, subject, content, report_id, payload, error)
     VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
     ON CONFLICT (workspace_id, dedup_key) DO NOTHING
     RETURNING id`,
    [input.kind, contentError ? 'failed' : input.status, input.dedupKey, input.channel, input.target, input.targetLabel,
     input.subject, input.content, input.reportId ?? null, JSON.stringify(input.payload ?? {}), input.error ?? contentError]);
  return result.rows[0]?.id ?? null;
}

async function enqueueSendJob(tx: TenantTransaction, workspaceId: string, eventId: string): Promise<void> {
  await tx.query(
    `INSERT INTO job (workspace_id, kind, payload)
     SELECT $1::uuid, 'notification.send', $2::jsonb FROM notification_event
     WHERE id = $3 AND workspace_id = $1 AND status = 'queued'`,
    [workspaceId, { eventId }, eventId]);
}

const dateKey = (iso: string) => iso.slice(0, 10);

export class NotificationService {
  constructor(private readonly database: Database) {}

  async listRules(actor: ActorContext) {
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const result = await tx.query<RuleRow>(
        `SELECT id, kind, channel, email, connected_account_id, weekly_template, weekly_delivery_mode,
                created_at::text AS "created_at", updated_at::text AS "updated_at"
           FROM notification_rule
          WHERE workspace_id = current_setting('app.workspace_id')::uuid
          ORDER BY kind`, []);
      return {
        rules: result.rows.map(row => ({
          id: row.id, kind: row.kind, channel: row.channel, email: row.email,
          connectedAccountId: row.connected_account_id,
          weeklyTemplate: row.weekly_template, weeklyDeliveryMode: row.weekly_delivery_mode,
          updatedAt: row.updated_at,
        })),
        weeklyTemplates: WEEKLY_TEMPLATES.map(template => ({ id: template, label: INSIGHT_TEMPLATE_LABELS[template].en })),
      };
    });
  }

  async putRule(actor: ActorContext, kindParam: unknown, body: unknown) {
    requirePermission(actor.role, 'workflow:run');
    const kind = kindSchema.parse(kindParam);
    const input = ruleInputSchema.parse(body ?? {});
    if (input.channel === 'email' && input.connectedAccountId) throw new HttpError(422, 'notification_rule_target_conflict');
    if (input.channel === 'discord' && (input.email || !input.connectedAccountId)) throw new HttpError(422, 'notification_rule_target_invalid');
    if (kind === 'weekly_report' && (!input.weeklyTemplate || !input.weeklyDeliveryMode)) throw new HttpError(422, 'notification_weekly_config_required');
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      if (input.channel === 'discord') {
        const resolved = await resolveTarget(tx, { channel: 'discord', email: null, connected_account_id: input.connectedAccountId! });
        if (!resolved.ok) throw new HttpError(422, resolved.error);
      }
      const result = await tx.query<{ id: string; updated_at: string }>(
        `INSERT INTO notification_rule (workspace_id, kind, channel, email, connected_account_id, weekly_template, weekly_delivery_mode, created_by)
         VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, kind) DO UPDATE
           SET channel = EXCLUDED.channel, email = EXCLUDED.email, connected_account_id = EXCLUDED.connected_account_id,
               weekly_template = EXCLUDED.weekly_template, weekly_delivery_mode = EXCLUDED.weekly_delivery_mode, updated_at = now()
         RETURNING id, updated_at::text AS "updated_at"`,
        [kind, input.channel, input.channel === 'email' ? input.email ?? null : null,
         input.channel === 'discord' ? input.connectedAccountId! : null,
         kind === 'weekly_report' ? input.weeklyTemplate! : null,
         kind === 'weekly_report' ? input.weeklyDeliveryMode! : null, actor.actorId]);
      await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'notification.rule_saved', { kind, channel: input.channel, weeklyTemplate: input.weeklyTemplate ?? null, weeklyDeliveryMode: input.weeklyDeliveryMode ?? null }]);
      return { id: result.rows[0]!.id, kind, updatedAt: result.rows[0]!.updated_at };
    });
  }

  async deleteRule(actor: ActorContext, kindParam: unknown) {
    requirePermission(actor.role, 'workflow:run');
    const kind = kindSchema.parse(kindParam);
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const result = await tx.query(
        `DELETE FROM notification_rule
          WHERE workspace_id = current_setting('app.workspace_id')::uuid AND kind = $1`, [kind]);
      if (result.rowCount) {
        await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
          [actor.workspaceId, actor.actorId, 'notification.rule_deleted', { kind }]);
      }
      return { deleted: result.rowCount > 0 };
    });
  }

  async listEvents(actor: ActorContext, query: unknown) {
    const filters = z.object({
      kind: z.enum([...NOTIFICATION_KINDS, 'weekly_ready'] as const).optional(),
      status: z.enum(['pending_approval', 'queued', 'sent', 'failed', 'acknowledged', 'resolved'] as const).optional(),
    }).strict().parse(query ?? {});
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const result = await tx.query(
        `SELECT id, kind, status, channel, target_label AS "targetLabel", subject, error,
                report_id AS "reportId", created_at::text AS "createdAt", sent_at::text AS "sentAt",
                acted_at::text AS "actedAt"
           FROM notification_event
          WHERE workspace_id = current_setting('app.workspace_id')::uuid
            AND ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR status = $2)
          ORDER BY created_at DESC LIMIT 50`,
        [filters.kind ?? null, filters.status ?? null]);
      return { events: result.rows };
    });
  }

  /** Weekly approval delivery: a human releases the frozen digest. */
  async approveEvent(actor: ActorContext, eventId: unknown) {
    requirePermission(actor.role, 'workflow:run');
    const id = z.string().uuid().parse(eventId);
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const result = await tx.query<{ id: string }>(
        `UPDATE notification_event SET status = 'queued'
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid
            AND kind = 'weekly_report' AND status = 'pending_approval'
          RETURNING id`, [id]);
      if (!result.rows[0]) throw new HttpError(409, 'notification_event_not_approvable');
      await enqueueSendJob(tx, actor.workspaceId, id);
      await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'notification.delivery_approved', { eventId: id }]);
      return { id, status: 'queued' as const };
    });
  }

  /** Urgent-risk loop closure: sent → acknowledged → resolved. */
  async actOnEvent(actor: ActorContext, eventId: unknown, body: unknown) {
    requirePermission(actor.role, 'workflow:run');
    const id = z.string().uuid().parse(eventId);
    const { action } = z.object({ action: z.enum(['acknowledge', 'resolve']) }).strict().parse(body ?? {});
    return this.database.withWorkspace(actor.workspaceId, async tx => {
      const allowed = action === 'acknowledge' ? ['sent'] : ['sent', 'acknowledged'];
      const result = await tx.query<{ id: string }>(
        `UPDATE notification_event SET status = $3, acted_at = now(), acted_by = $4
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid
            AND kind = 'urgent_risk' AND status = ANY($2::text[])
          RETURNING id`, [id, allowed, action === 'acknowledge' ? 'acknowledged' : 'resolved', actor.actorId]);
      if (!result.rows[0]) throw new HttpError(409, 'notification_event_not_actionable');
      await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, `notification.alert_${action}d`, { eventId: id }]);
      return { id, status: action === 'acknowledge' ? 'acknowledged' as const : 'resolved' as const };
    });
  }
}

export class ScheduledNotificationService {
  /**
   * planForReport 只需要 withWorkspace（worker 上下文）；定时入口还需要
   * withAdmin（egg schedule 无租户上下文，候选枚举走 SECURITY DEFINER）。
   */
  constructor(private readonly database: Pick<Database, 'withWorkspace'> & Partial<Pick<Database, 'withAdmin'>>) {}

  private withAdmin<T>(operation: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    if (!this.database.withAdmin) throw new Error('ScheduledNotificationService requires withAdmin for schedule entry points');
    return this.database.withAdmin(operation);
  }

  /**
   * Worker job `notification.plan`: a report just generated — create the
   * dedup-keyed events its workspace's rules call for. Runs inside the
   * tenant transaction; job enqueue is atomic with event creation.
   */
  async planForReport(workspaceId: string, reportId: unknown): Promise<{ created: number }> {
    const id = z.string().uuid().parse(reportId);
    return this.database.withWorkspace(workspaceId, async tx => {
      const report = await tx.query<{
        template: InsightTemplate; title: string; report: Record<string, unknown>;
        itemCount: number; droppedCitations: number; generatedAt: string;
      }>(
        `SELECT template, title, report, item_count AS "itemCount", dropped_citations AS "droppedCitations",
                COALESCE(generated_at, created_at)::text AS "generatedAt"
           FROM insight_report
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generated'`, [id]);
      const row = report.rows[0];
      if (!row) return { created: 0 }; // report failed validation afterwards; nothing to plan
      const rules = await tx.query<RuleRow>(
        `SELECT id, kind, channel, email, connected_account_id, weekly_template, weekly_delivery_mode,
                created_at::text AS "created_at", updated_at::text AS "updated_at"
           FROM notification_rule
          WHERE workspace_id = current_setting('app.workspace_id')::uuid`, []);
      let created = 0;
      const emit = async (rule: RuleRow, event: { kind: string; status: 'pending_approval' | 'queued'; dedupKey: string; subject: string; content: string; payload?: Record<string, unknown> }) => {
        const resolved = await resolveTarget(tx, rule);
        const eventId = await insertEvent(tx, resolved.ok
          ? { ...event, channel: rule.channel, target: resolved.target, targetLabel: resolved.targetLabel, reportId: id }
          : { ...event, status: 'failed', channel: rule.channel, target: '-', targetLabel: '-', error: resolved.error, reportId: id });
        if (!eventId) return;
        created += 1;
        if (event.status === 'queued' && resolved.ok) await enqueueSendJob(tx, workspaceId, eventId);
      };

      for (const rule of rules.rows) {
        if (rule.kind === 'morning_push' && row.template === 'daily_ops') {
          await emit(rule, {
            kind: 'morning_push', status: 'queued', dedupKey: `morning_push:${dateKey(row.generatedAt)}`,
            subject: `[Piggybot] ${row.title}`.slice(0, 200),
            content: renderReportDigest({ template: row.template, title: row.title, itemCount: row.itemCount, droppedCitations: row.droppedCitations, report: row.report }),
          });
        }
        if (rule.kind === 'weekly_report' && row.template === rule.weekly_template) {
          const weekKey = isoWeekStart(new Date(row.generatedAt)).toISOString().slice(0, 10);
          const digest = renderReportDigest({ template: row.template, title: row.title, itemCount: row.itemCount, droppedCitations: row.droppedCitations, report: row.report });
          if (rule.weekly_delivery_mode === 'auto') {
            await emit(rule, {
              kind: 'weekly_report', status: 'queued', dedupKey: `weekly_report:${weekKey}`,
              subject: `[Piggybot] ${row.title}`.slice(0, 200), content: digest,
            });
          } else {
            // 审批交付：完整摘要冻结为 pending_approval，先只发就绪通知。
            await emit(rule, {
              kind: 'weekly_report', status: 'pending_approval', dedupKey: `weekly_report:${weekKey}`,
              subject: `[Piggybot] ${row.title}`.slice(0, 200), content: digest,
            });
            // An oversized report is failed, not awaiting approval. Do not announce it as ready.
            if (notificationContentError(rule.channel, digest)) continue;
            const ready = renderWeeklyReady({ title: row.title, template: row.template });
            await emit(rule, {
              kind: 'weekly_ready', status: 'queued', dedupKey: `weekly_ready:${weekKey}`,
              subject: ready.subject, content: ready.content,
            });
          }
        }
        if (rule.kind === 'urgent_risk') {
          const risks = detectUrgentRisks(row.template, row.report);
          if (risks.length > 0) {
            await emit(rule, {
              kind: 'urgent_risk', status: 'queued', dedupKey: `urgent_risk:${id}`,
              subject: `[Piggybot] Urgent risk in "${row.title}"`.slice(0, 200),
              content: renderUrgentAlert({ reportTitle: row.title, template: row.template, risks }),
              payload: { risks },
            });
          }
        }
      }
      return { created };
    });
  }

  /** egg schedule 20:00 UTC：今日执行复盘（反馈时间归属，含旧报告动作）。 */
  async enqueueEveningRecaps(now = new Date()): Promise<number> {
    const candidates = await this.withAdmin(async tx =>
      (await tx.query<{ workspace_id: string }>('SELECT workspace_id FROM scheduled_notification_workspaces($1)', ['evening_recap'])).rows);
    const today = now.toISOString().slice(0, 10);
    const dayStart = `${today}T00:00:00.000Z`;
    let enqueued = 0;
    for (const candidate of candidates) {
      const made = await this.database.withWorkspace(candidate.workspace_id, async tx => {
        const rules = await tx.query<RuleRow>(
          `SELECT id, kind, channel, email, connected_account_id, weekly_template, weekly_delivery_mode,
                  created_at::text AS "created_at", updated_at::text AS "updated_at"
             FROM notification_rule
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND kind = 'evening_recap'`, []);
        const rule = rules.rows[0];
        if (!rule) return false;
        const reports = await tx.query<{ template: InsightTemplate; report: Record<string, unknown>; feedback: Record<string, unknown> }>(
          `SELECT template, report, action_feedback AS feedback
             FROM insight_report
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generated'
              AND action_feedback <> '{}'::jsonb`, []);
        const completed: Array<{ title: string; effect: string }> = [];
        let planned = 0;
        let dismissed = 0;
        for (const report of reports.rows) {
          for (const action of reportActions(report.template, report.report)) {
            const raw = report.feedback[action.key] as Record<string, unknown> | undefined;
            if (!raw) continue;
            const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : '';
            if (!updatedAt.startsWith(today)) continue;
            if (raw.status === 'completed') completed.push({ title: action.title, effect: typeof raw.effect === 'string' ? raw.effect : 'unknown' });
            if (raw.status === 'planned') planned += 1;
            if (raw.status === 'dismissed') dismissed += 1;
          }
        }
        const todayTasks = await tx.query<{ report: Record<string, unknown>; feedback: Record<string, unknown> }>(
          `SELECT report, action_feedback AS feedback
             FROM insight_report
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generated'
              AND template = 'daily_ops' AND generated_at >= $1::timestamptz
            ORDER BY generated_at DESC LIMIT 1`, [dayStart]);
        const taskReport = todayTasks.rows[0];
        const unreviewedTasks = taskReport
          ? reportActions('daily_ops', taskReport.report).filter(action => !taskReport.feedback[action.key]).length
          : 0;
        if (completed.length === 0 && planned === 0 && dismissed === 0 && unreviewedTasks === 0) return false;
        const resolved = await resolveTarget(tx, rule);
        const content = renderEveningRecap({ date: today, completed, planned, dismissed, unreviewedTasks });
        const eventId = await insertEvent(tx, resolved.ok
          ? { kind: 'evening_recap', status: 'queued', dedupKey: `evening_recap:${today}`, channel: rule.channel, target: resolved.target, targetLabel: resolved.targetLabel, subject: `[Piggybot] Evening recap ${today}`, content }
          : { kind: 'evening_recap', status: 'failed', dedupKey: `evening_recap:${today}`, channel: rule.channel, target: '-', targetLabel: '-', subject: `[Piggybot] Evening recap ${today}`, content, error: resolved.error });
        if (!eventId) return false;
        if (resolved.ok) await enqueueSendJob(tx, candidate.workspace_id, eventId);
        return true;
      });
      if (made) enqueued += 1;
    }
    return enqueued;
  }

  /** egg schedule 周一 08:00 UTC：为订阅工作区入队周报生成（6 天去重）。 */
  async enqueueWeeklyReports(): Promise<number> {
    const candidates = await this.withAdmin(async tx =>
      (await tx.query<{ workspace_id: string }>('SELECT workspace_id FROM scheduled_notification_workspaces($1)', ['weekly_report'])).rows);
    let enqueued = 0;
    for (const candidate of candidates) {
      const made = await this.database.withWorkspace(candidate.workspace_id, async tx => {
        const rules = await tx.query<RuleRow>(
          `SELECT id, kind, channel, email, connected_account_id, weekly_template, weekly_delivery_mode,
                  created_at::text AS "created_at", updated_at::text AS "updated_at"
             FROM notification_rule
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND kind = 'weekly_report'`, []);
        const rule = rules.rows[0];
        if (!rule?.weekly_template) return false;
        const recent = await tx.query(
          `SELECT 1 FROM insight_report
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND template = $1
              AND created_at > now() - interval '6 days' LIMIT 1`, [rule.weekly_template]);
        if (recent.rows.length > 0) return false;
        const owner = await tx.query<{ user_id: string }>(
          `SELECT user_id FROM workspace_membership
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND role = 'owner'
            ORDER BY created_at ASC LIMIT 1`, []);
        const ownerId = owner.rows[0]?.user_id;
        if (!ownerId) return false;
        const batches = await tx.query<{ id: string }>(
          `SELECT id FROM import_batch
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND status = 'classified'
            ORDER BY created_at DESC LIMIT 5`, []);
        if (batches.rows.length === 0) return false;
        const items = await tx.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM import_item i JOIN import_batch b ON b.id = i.batch_id
            WHERE b.workspace_id = current_setting('app.workspace_id')::uuid AND b.status = 'classified'`, []);
        const label = INSIGHT_TEMPLATE_LABELS[rule.weekly_template].zh;
        const report = await tx.query<{ id: string }>(
          `INSERT INTO insight_report (workspace_id, template, title, model_band, batch_ids, item_count, created_by)
           VALUES (current_setting('app.workspace_id')::uuid, $1, $2, 'eco', $3::jsonb, $4, $5)
           RETURNING id`,
          [rule.weekly_template, `${label} · 周报 ${new Date().toISOString().slice(0, 10)}`,
           JSON.stringify(batches.rows.map(row => row.id)), Number(items.rows[0]?.count ?? 0), ownerId]);
        const reportId = report.rows[0]?.id;
        if (!reportId) return false;
        await tx.query(`INSERT INTO job (workspace_id, kind, payload) VALUES ($1, 'insight.generate', $2)`,
          [candidate.workspace_id, { reportId }]);
        return true;
      });
      if (made) enqueued += 1;
    }
    return enqueued;
  }
}
