import { z } from 'zod';

import { usageSnapshot } from '../billing/guardrails';
import type { ActorContext } from '../contracts/domain';
import {
  createTopicRunSchema,
  type TopicItemListView,
  type TopicItemView,
  type TopicListView,
  type TopicRunView,
  type TopicView,
} from '../contracts/topics';
import { Database, type TenantTransaction } from '../foundation/database';
import { requirePermission } from '../foundation/rbac';
import { HttpError } from '../http/errors';

const TOPIC_ITEMS_PAGE_MAX = 100;

type TopicRunRow = {
  id: string; status: TopicRunView['status']; modelBand: string;
  itemCount: number; topicCount: number; error: string | null;
  createdAt: string; completedAt: string | null;
};

type TopicRow = {
  id: string; runId: string; key: string; label: string; description: string; itemCount: number;
};

/**
 * Module 2（全量主题聚类与可信计数）入口。
 *
 * 一次"主题运行"对当前全部已分类条目做两阶段处理（worker 侧执行）：
 * 1. propose —— LLM 从 ≤200 条抽样中归纳 3-24 个具体主题（taxonomy）；
 * 2. assign —— 分块（50 条/chunk，按 chunk 计量 credits）把每条item
 *    指派到 0-3 个主题，证据逐字校验后落库。
 *
 * "某需求被提到 N 次"永远等于 item_topic 的 SQL COUNT，LLM 无从编造；
 * 核验路径是 topicItems() 逐条返回原文与证据。
 */
export class TopicService {
  constructor(private readonly database: Database) {}

  /**
   * 创建一次全量主题运行。与 createInsight 同一门禁：消耗 LLM，必须在
   * 付费/试用有效态且 credits 未耗尽。同一工作区同一时间只允许一个
   * 非终态运行（409），避免并发运行互相覆盖进度标记。
   */
  async startTopicRun(actor: ActorContext, body: unknown): Promise<TopicRunView> {
    requirePermission(actor.role, 'workflow:run');
    const input = createTopicRunSchema.parse(body ?? {});

    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
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
      const usage = await usageSnapshot(tx);
      if (usage.aiCreditsAvailable <= 0) {
        throw new HttpError(402, 'ai_credits_exhausted');
      }

      const active = await tx.query<{ id: string }>(
        `SELECT id FROM topic_run
          WHERE workspace_id = current_setting('app.workspace_id')::uuid
            AND status IN ('pending', 'proposing', 'assigning')
          LIMIT 1`,
        [],
      );
      if (active.rows[0]) throw new HttpError(409, 'topic_run_already_active');

      const items = await tx.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM import_item
          WHERE workspace_id = current_setting('app.workspace_id')::uuid AND classified_at IS NOT NULL`,
        [],
      );
      const itemCount = Number(items.rows[0]?.count ?? 0);
      if (!itemCount) throw new HttpError(422, 'topics_no_classified_items');

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO topic_run (workspace_id, model_band, item_count, created_by)
         VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3)
         RETURNING id`,
        [input.modelBand, itemCount, actor.actorId],
      );
      const runId = inserted.rows[0]?.id;
      if (!runId) throw new Error('topic_run_insert_failed');

      await tx.query(
        "INSERT INTO job (workspace_id, kind, payload) VALUES (current_setting('app.workspace_id')::uuid, 'topics.cluster', $1)",
        [JSON.stringify({ runId })],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'topics.run_created', { runId, itemCount, modelBand: input.modelBand }],
      );

      const view = await this.runView(tx, runId);
      if (!view) throw new Error('topic_run_insert_failed');
      return view;
    });
  }

  /**
   * 最近一次运行 + 其主题列表。主题的 itemCount 取 item_topic 的实时
   * COUNT（而非完成时回填的列），因此进行中的运行也能看到确定进度。
   */
  async listTopics(actor: ActorContext): Promise<TopicListView> {
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const run = await tx.query<{ id: string }>(
        `SELECT id FROM topic_run
          WHERE workspace_id = current_setting('app.workspace_id')::uuid
          ORDER BY created_at DESC LIMIT 1`,
        [],
      );
      const runId = run.rows[0]?.id;
      if (!runId) return { run: null, topics: [] };
      const view = await this.runView(tx, runId);
      const topics = await this.topicViews(tx, runId);
      return { run: view, topics };
    });
  }

  /**
   * 主题下被指派的条目（核验路径）：逐条返回原文、逐字证据与置信度。
   * total 是 SQL COUNT —— 与列表页展示的"被提到 N 次"同口径。
   */
  async topicItems(actor: ActorContext, topicId: unknown, query: unknown): Promise<TopicItemListView> {
    const id = z.string().uuid().parse(topicId);
    const { limit, offset } = z.object({
      limit: z.coerce.number().int().min(1).max(TOPIC_ITEMS_PAGE_MAX).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(query ?? {});

    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const topic = await tx.query<TopicRow>(
        `SELECT t.id, t.run_id AS "runId", t.topic_key AS key, t.label, t.description,
                (SELECT COUNT(*)::int FROM item_topic it WHERE it.topic_id = t.id) AS "itemCount"
           FROM topic t
          WHERE t.id = $1 AND t.workspace_id = current_setting('app.workspace_id')::uuid`,
        [id],
      );
      const topicRow = topic.rows[0];
      if (!topicRow) throw new HttpError(404, 'topic_not_found');

      const total = await tx.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM item_topic
          WHERE topic_id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`,
        [id],
      );
      const rows = await tx.query<TopicItemView>(
        `SELECT it.item_id AS "itemId", i.platform, i.author, i.text,
                it.evidence, it.confidence::float8 AS confidence, i.created_at::text AS "createdAt"
           FROM item_topic it JOIN import_item i ON i.id = it.item_id
          WHERE it.topic_id = $1 AND it.workspace_id = current_setting('app.workspace_id')::uuid
          ORDER BY it.confidence DESC, i.created_at DESC, it.item_id
          LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );
      return { topic: topicRow, total: Number(total.rows[0]?.count ?? 0), items: rows.rows };
    });
  }

  private async runView(tx: TenantTransaction, runId: string): Promise<TopicRunView | null> {
    const result = await tx.query<TopicRunRow>(
      `SELECT id, status, model_band AS "modelBand", item_count AS "itemCount",
              topic_count AS "topicCount", error,
              created_at::text AS "createdAt", completed_at::text AS "completedAt"
         FROM topic_run
        WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`,
      [runId],
    );
    return result.rows[0] ?? null;
  }

  private async topicViews(tx: TenantTransaction, runId: string): Promise<TopicView[]> {
    const result = await tx.query<TopicRow>(
      `SELECT t.id, t.run_id AS "runId", t.topic_key AS key, t.label, t.description,
              (SELECT COUNT(*)::int FROM item_topic it WHERE it.topic_id = t.id) AS "itemCount"
         FROM topic t
        WHERE t.run_id = $1 AND t.workspace_id = current_setting('app.workspace_id')::uuid
        ORDER BY "itemCount" DESC, t.topic_key`,
      [runId],
    );
    return result.rows;
  }
}
