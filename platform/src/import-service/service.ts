import { z } from 'zod';

import { usageSnapshot } from '../billing/guardrails';
import type { ActorContext } from '../contracts/domain';
import { CONTENT_TAGS, modelBandSchema, type ContentTag } from '../contracts/tagging';
import { Database, type TenantTransaction } from '../foundation/database';
import { requirePermission } from '../foundation/rbac';
import { HttpError } from '../http/errors';
import { csvRecordToItem, parseCsv, pasteToItems, type ParsedItem } from './csv';

const MAX_ITEMS_PER_BATCH = 5_000;
const MAX_CONTENT_BYTES = 2_000_000;

const createImportSchema = z.object({
  label: z.string().trim().min(1).max(120),
  sourceType: z.enum(['csv', 'paste']),
  content: z.string().min(1).max(MAX_CONTENT_BYTES),
  modelBand: modelBandSchema.default('eco'),
}).strict();

export interface ImportBatchView {
  id: string;
  label: string;
  sourceType: string;
  status: string;
  modelBand: string;
  itemCount: number;
  tagDistribution: Partial<Record<ContentTag, number>>;
  createdAt: string;
  classifiedAt: string | null;
}

export interface ImportItemView {
  id: string;
  platform: string;
  author: string | null;
  text: string;
  metrics: Record<string, unknown>;
  tags: Array<{ tag: ContentTag; confidence: number; evidence: string }>;
}

/** Data import entry point: parse → persist → enqueue LLM classification. */
export class ImportService {
  constructor(private readonly database: Database) {}

  async createImport(actor: ActorContext, body: unknown): Promise<ImportBatchView> {
    requirePermission(actor.role, 'workflow:run');
    const input = createImportSchema.parse(body);
    const items = input.sourceType === 'csv'
      ? parseCsv(input.content).map(csvRecordToItem).filter((item): item is ParsedItem => Boolean(item))
      : pasteToItems(input.content);
    if (!items.length) throw new HttpError(422, 'import_no_items');
    if (items.length > MAX_ITEMS_PER_BATCH) throw new HttpError(422, 'import_too_large');

    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      // 未订阅工作区只允许预览（灰度）；导入会触发 LLM 分类，必须在付费态。
      const billing = await tx.query<{ status: string; trialEndsAt: string | null }>(
        `SELECT subscription_status AS status, trial_ends_at::text AS "trialEndsAt"
           FROM workspace_billing WHERE workspace_id = current_setting('app.workspace_id')::uuid`,
        [],
      );
      const row = billing.rows[0];
      const trialActive = row?.trialEndsAt ? new Date(row.trialEndsAt).getTime() > Date.now() : false;
      if (!row || (row.status !== 'active' && row.status !== 'trialing' && !trialActive)) {
        throw new HttpError(402, 'subscription_required');
      }
      // 迭代 5：额度耗尽在请求时即反馈（订阅有效性由上方门禁负责；
      // worker 侧 reserveAiRun 仍是权威扣费点，供应商超限等暂停场景由它兜底延迟）。
      const usage = await usageSnapshot(tx);
      if (usage.aiCreditsAvailable <= 0) {
        throw new HttpError(402, 'ai_credits_exhausted');
      }

      const batch = await tx.query<{ id: string; createdAt: string }>(
        `INSERT INTO import_batch (workspace_id, label, source_type, model_band, item_count, created_by)
         VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5)
         RETURNING id, created_at::text AS "createdAt"`,
        [input.label, input.sourceType, input.modelBand, items.length, actor.actorId],
      );
      const batchId = batch.rows[0]?.id;
      if (!batchId) throw new Error('import_batch_insert_failed');

      const CHUNK = 200;
      for (let offset = 0; offset < items.length; offset += CHUNK) {
        const slice = items.slice(offset, offset + CHUNK);
        const values: unknown[] = [];
        const tuples = slice.map((item, index) => {
          const base = index * 6;
          values.push(batchId, item.platform, item.externalId ?? null, item.author ?? null, item.text, JSON.stringify(item.metrics));
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb)`;
        });
        await tx.query(
          `INSERT INTO import_item (workspace_id, batch_id, platform, external_id, author, text, metrics)
           SELECT current_setting('app.workspace_id')::uuid, v.*
             FROM (VALUES ${tuples.join(', ')}) AS v(batch_id, platform, external_id, author, text, metrics)`,
          values,
        );
      }

      await tx.query(
        "INSERT INTO job (workspace_id, kind, payload) VALUES (current_setting('app.workspace_id')::uuid, 'import.classify', $1)",
        [JSON.stringify({ batchId })],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'import.created', { batchId, sourceType: input.sourceType, itemCount: items.length, modelBand: input.modelBand }],
      );
      return this.batchView(tx, batchId);
    });
  }

  async listImports(actor: ActorContext): Promise<ImportBatchView[]> {
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const batches = await tx.query<{ id: string }>(
        'SELECT id FROM import_batch WHERE workspace_id = current_setting(\'app.workspace_id\')::uuid ORDER BY created_at DESC LIMIT 50',
        [],
      );
      const views: ImportBatchView[] = [];
      for (const row of batches.rows) views.push(await this.batchView(tx, row.id));
      return views;
    });
  }

  async importDetail(actor: ActorContext, batchId: unknown): Promise<{ batch: ImportBatchView; items: ImportItemView[] }> {
    const id = z.string().uuid().parse(batchId);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const batch = await this.batchView(tx, id);
      const items = await tx.query<{
        id: string; platform: string; author: string | null; text: string; metrics: Record<string, unknown>;
        tag: ContentTag | null; confidence: string | null; evidence: string | null;
      }>(
        `SELECT i.id, i.platform, i.author, i.text, i.metrics,
                t.tag, t.confidence::text, t.evidence
           FROM import_item i
           LEFT JOIN item_tag t ON t.item_id = i.id
          WHERE i.batch_id = $1 AND i.workspace_id = current_setting('app.workspace_id')::uuid
          ORDER BY i.created_at, i.id`,
        [id],
      );
      const byItem = new Map<string, ImportItemView>();
      for (const row of items.rows) {
        let view = byItem.get(row.id);
        if (!view) {
          view = { id: row.id, platform: row.platform, author: row.author, text: row.text, metrics: row.metrics, tags: [] };
          byItem.set(row.id, view);
        }
        if (row.tag && CONTENT_TAGS.includes(row.tag) && row.evidence) {
          view.tags.push({ tag: row.tag, confidence: Number(row.confidence ?? 0), evidence: row.evidence });
        }
      }
      return { batch, items: [...byItem.values()] };
    });
  }

  private async batchView(tx: TenantTransaction, batchId: string): Promise<ImportBatchView> {
    const batch = await tx.query<{
      id: string; label: string; sourceType: string; status: string; modelBand: string;
      itemCount: number; createdAt: string; classifiedAt: string | null;
    }>(
      `SELECT id, label, source_type AS "sourceType", status, model_band AS "modelBand",
              item_count AS "itemCount", created_at::text AS "createdAt", classified_at::text AS "classifiedAt"
         FROM import_batch
        WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`,
      [batchId],
    );
    const row = batch.rows[0];
    if (!row) throw new HttpError(404, 'import_not_found');
    const distribution = await tx.query<{ tag: ContentTag; count: string }>(
      `SELECT t.tag, COUNT(*)::text AS count
         FROM item_tag t JOIN import_item i ON i.id = t.item_id
        WHERE i.batch_id = $1 AND t.workspace_id = current_setting('app.workspace_id')::uuid
        GROUP BY t.tag`,
      [batchId],
    );
    const tagDistribution: Partial<Record<ContentTag, number>> = {};
    for (const entry of distribution.rows) {
      if (CONTENT_TAGS.includes(entry.tag)) tagDistribution[entry.tag] = Number(entry.count);
    }
    return { ...row, tagDistribution };
  }
}
