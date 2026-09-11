import { z } from 'zod';

import type { ActorContext } from '../contracts/domain';
import {
  INSIGHT_TEMPLATE_LABELS,
  createInsightReportSchema,
  insightTemplateSchema,
  reportDeliverySchema,
  requestInsightDeliverySchema,
  type InsightReportView,
  type InsightTemplate,
  type ReportDelivery,
} from '../contracts/insights';
import { Database, type TenantTransaction } from '../foundation/database';
import { requirePermission } from '../foundation/rbac';
import { HttpError } from '../http/errors';

const MAX_SOURCE_BATCHES = 10;

type InsightReportRow = {
  id: string; template: InsightTemplate; title: string; status: InsightReportView['status'];
  modelBand: string; batchIds: string[]; itemCount: number; droppedCitations: number;
  error: string | null; createdAt: string; generatedAt: string | null; report: Record<string, unknown> | null;
  delivery: unknown;
};

/**
 * 迭代 2（P0 三模板）洞察报告入口：选择模板 + 导入批次 → 聚合证据包
 * → LLM 生成结构化报告（引用逐字校验后落库）。
 */
export class InsightService {
  constructor(private readonly database: Database) {}

  async createInsight(actor: ActorContext, body: unknown): Promise<InsightReportView> {
    requirePermission(actor.role, 'workflow:run');
    const input = createInsightReportSchema.parse(body);

    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      // 与导入器同一门禁：报告生成消耗 LLM，必须在付费/试用有效态。
      const billing = await tx.query<{ status: string; trialEndsAt: string | null }>(
        `SELECT subscription_status AS status, trial_ends_at::text AS "trialEndsAt"
           FROM workspace_billing WHERE workspace_id = current_setting('app.workspace_id')::uuid`,
        [],
      );
      const billingRow = billing.rows[0];
      const trialActive = billingRow?.trialEndsAt ? new Date(billingRow.trialEndsAt).getTime() > Date.now() : false;
      if (!billingRow || (billingRow.status !== 'active' && billingRow.status !== 'trialing' && !trialActive)) {
        throw new HttpError(402, 'subscription_required');
      }

      // 未指定批次时取最近已分类的批次；指定时必须全部属于本租户且已分类。
      const batches = input.batchIds?.length
        ? await tx.query<{ id: string }>(
          `SELECT id FROM import_batch
            WHERE workspace_id = current_setting('app.workspace_id')::uuid
              AND id = ANY($1::uuid[]) AND status = 'classified'`,
          [input.batchIds],
        )
        : await tx.query<{ id: string }>(
          `SELECT id FROM import_batch
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND status = 'classified'
            ORDER BY created_at DESC LIMIT $1`,
          [MAX_SOURCE_BATCHES],
        );
      const batchIds = batches.rows.map((row) => row.id);
      if (input.batchIds?.length && batchIds.length !== input.batchIds.length) {
        throw new HttpError(422, 'insight_batches_not_ready');
      }
      // daily_ops 是洞察聚合调度器：没有已分类批次时，允许仅凭既有报告生成。
      if (!batchIds.length) {
        if (input.template !== 'daily_ops') throw new HttpError(422, 'insight_no_classified_batches');
        const prior = await tx.query<{ id: string }>(
          `SELECT id FROM insight_report
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generated'
            LIMIT 1`,
          [],
        );
        if (!prior.rows[0]) throw new HttpError(422, 'insight_no_classified_batches');
      }

      const itemCount = await tx.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM import_item
          WHERE workspace_id = current_setting('app.workspace_id')::uuid AND batch_id = ANY($1::uuid[])`,
        [batchIds],
      );
      const count = Number(itemCount.rows[0]?.count ?? 0);
      if (!count && input.template !== 'daily_ops') throw new HttpError(422, 'insight_no_items');

      const labels = INSIGHT_TEMPLATE_LABELS[input.template];
      const title = input.title ?? `${labels.zh} · ${new Date().toISOString().slice(0, 10)}`;
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO insight_report (workspace_id, template, title, model_band, batch_ids, item_count, created_by)
         VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4::jsonb, $5, $6)
         RETURNING id`,
        [input.template, title, input.modelBand, JSON.stringify(batchIds), count, actor.actorId],
      );
      const reportId = inserted.rows[0]?.id;
      if (!reportId) throw new Error('insight_report_insert_failed');

      await tx.query(
        "INSERT INTO job (workspace_id, kind, payload) VALUES (current_setting('app.workspace_id')::uuid, 'insight.generate', $1)",
        [JSON.stringify({ reportId })],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'insight.created', { reportId, template: input.template, batchIds, itemCount: count, modelBand: input.modelBand }],
      );

      const view = await this.reportView(tx, reportId);
      if (!view) throw new Error('insight_report_insert_failed');
      return view;
    });
  }

  async listInsights(actor: ActorContext): Promise<InsightReportView[]> {
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const rows = await tx.query<{ id: string }>(
        `SELECT id FROM insight_report
          WHERE workspace_id = current_setting('app.workspace_id')::uuid
          ORDER BY created_at DESC LIMIT 50`,
        [],
      );
      const views: InsightReportView[] = [];
      for (const row of rows.rows) {
        const view = await this.reportView(tx, row.id);
        if (view) views.push(view);
      }
      return views;
    });
  }

  /**
   * 每日运营任务定时入口（egg schedule 调用）。跨租户枚举封装在
   * SECURITY DEFINER 函数 enqueue_daily_ops_reports() 内（与 claim_next_job 同模式）。
   */
  async enqueueScheduledDailyOps(): Promise<number> {
    return this.database.withAdmin(async (tx) => {
      const result = await tx.query<{ enqueued: number }>('SELECT enqueue_daily_ops_reports() AS enqueued');
      return Number(result.rows[0]?.enqueued ?? 0);
    });
  }

  async insightDetail(actor: ActorContext, reportId: unknown): Promise<InsightReportView> {
    const id = z.string().uuid().parse(reportId);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const view = await this.reportView(tx, id);
      if (!view) throw new HttpError(404, 'insight_not_found');
      return view;
    });
  }

  /**
   * 迭代 4（报告外发闭环）：请求把已生成的报告推送到邮箱/Discord。
   * 不产生 LLM 消耗，因此不加订阅门禁；但报告必须已生成，且同一时间
   * 只允许一个待审批的外发请求。目标在请求时快照进 delivery jsonb，
   * 审批后 worker 按快照投递（审批人看到什么就发什么）。
   */
  async requestDelivery(actor: ActorContext, reportId: unknown, body: unknown): Promise<InsightReportView> {
    requirePermission(actor.role, 'workflow:run');
    const id = z.string().uuid().parse(reportId);
    const input = requestInsightDeliverySchema.parse(body);

    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const report = await tx.query<{ title: string; status: string; delivery: unknown }>(
        `SELECT title, status, delivery FROM insight_report
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid
          FOR UPDATE`,
        [id],
      );
      const row = report.rows[0];
      if (!row) throw new HttpError(404, 'insight_not_found');
      if (row.status !== 'generated') throw new HttpError(422, 'insight_not_generated');
      const current = reportDeliverySchema.safeParse(row.delivery);
      if (current.success && (current.data.status === 'awaiting_approval' || current.data.status === 'approved')) {
        throw new HttpError(409, 'insight_delivery_pending');
      }

      // 目标解析：邮箱默认发工作区 owner；Discord 必须是本租户已连接、
      // 具备 social.create_post 能力的 discord 账号。
      let target: string;
      let targetLabel: string;
      if (input.channel === 'email') {
        if (input.email) {
          target = input.email;
        } else {
          const owner = await tx.query<{ email: string }>(
            `SELECT u.email::text AS email
               FROM workspace_membership m JOIN app_user u ON u.id = m.user_id
              WHERE m.workspace_id = current_setting('app.workspace_id')::uuid AND m.role = 'owner'
              ORDER BY m.created_at ASC LIMIT 1`,
            [],
          );
          const ownerEmail = owner.rows[0]?.email;
          if (!ownerEmail) throw new HttpError(422, 'insight_delivery_target_missing');
          target = ownerEmail;
        }
        targetLabel = target;
      } else {
        const account = await tx.query<{ displayName: string; status: string; platform: string; capabilities: string[] }>(
          `SELECT display_name AS "displayName", status, platform, capabilities
             FROM connected_account
            WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND provider = 'zernio'`,
          [input.connectedAccountId],
        );
        const connected = account.rows[0];
        // capability 值来自 Zernio（publish/schedule/analytics），与
        // connector-service/actions.ts 的 actionCapabilities 映射一致。
        if (!connected || connected.platform !== 'discord' || connected.status !== 'connected'
          || !connected.capabilities.includes('publish')) {
          throw new HttpError(422, 'insight_delivery_target_invalid');
        }
        target = input.connectedAccountId as string;
        targetLabel = connected.displayName;
      }

      const requestedAction = {
        actionType: 'insight.deliver_report',
        summary: `Send report "${row.title}" via ${input.channel} to ${targetLabel}`,
        parameters: { reportId: id, channel: input.channel, target, targetLabel },
      };
      const approval = await tx.query<{ id: string }>(
        `INSERT INTO approval_request (workspace_id, run_id, insight_report_id, status, requested_action)
         VALUES (current_setting('app.workspace_id')::uuid, NULL, $1, 'pending', $2)
         RETURNING id`,
        [id, requestedAction],
      );
      const approvalId = approval.rows[0]?.id;
      if (!approvalId) throw new Error('insight_delivery_approval_failed');

      const delivery: ReportDelivery = {
        status: 'awaiting_approval',
        channel: input.channel,
        target,
        targetLabel,
        approvalId,
        requestedBy: actor.actorId,
        requestedAt: new Date().toISOString(),
      };
      await tx.query(
        'UPDATE insight_report SET delivery = $2::jsonb WHERE id = $1 AND workspace_id = current_setting(\'app.workspace_id\')::uuid',
        [id, JSON.stringify(delivery)],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'insight.delivery_requested', { reportId: id, approvalId, channel: input.channel, targetLabel }],
      );

      const view = await this.reportView(tx, id);
      if (!view) throw new Error('insight_delivery_approval_failed');
      return view;
    });
  }

  private async reportView(tx: TenantTransaction, reportId: string): Promise<InsightReportView | null> {
    const result = await tx.query<InsightReportRow>(
      `SELECT id, template, title, status, model_band AS "modelBand", batch_ids AS "batchIds",
              item_count AS "itemCount", dropped_citations AS "droppedCitations",
              error, created_at::text AS "createdAt", generated_at::text AS "generatedAt", report, delivery
         FROM insight_report
        WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`,
      [reportId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const template = insightTemplateSchema.parse(row.template);
    const delivery = reportDeliverySchema.safeParse(row.delivery);
    return { ...row, template, delivery: delivery.success ? delivery.data : null };
  }
}
