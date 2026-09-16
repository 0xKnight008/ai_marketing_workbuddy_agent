import { createHash } from 'node:crypto';
import { templateAcceptanceIssues } from '../insight-service/template-acceptance';
import { rankReviewReport } from '../insight-service/review-ranking';

import { z } from 'zod';

import { actionPlanSchema, type ActionPlan, type AiRuntimeEvent } from '../contracts/ai-runtime-event';
import { classifyResultSchema, type TagAssignment } from '../contracts/tagging';
import { TOPIC_ASSIGN_CHUNK, TOPIC_PROPOSE_SAMPLE, topicAssignmentResultSchema, topicProposeResultSchema, type TopicAssignmentResult, type TopicTaxonomyEntry } from '../contracts/topics';
import { insightResultSchemas, insightTemplateSchema, reportDeliverySchema, type InsightTemplate } from '../contracts/insights';
import { buildEvidencePack, enforceGroundedConclusions, validateReportCitations, type EvidenceSourceRow, type GroundingStats } from '../insight-service/evidence-pack';
import { sendReportEmail, type ReportEmailConfig } from '../insight-service/delivery';
import type { BrandContextSnapshot } from '../contracts/domain';
import { MODEL_BAND_POLICIES, MODEL_BANDS, type ModelBand } from '../billing/plans';
import { projectedActionUsage, recordSuccessfulAction, reserveAiRun, type AiReservation, type UsageSnapshot } from '../billing/guardrails';
import { isAnnouncementWorkflow } from '../contracts/workflow-definition';
import { assertExecutableAction, type ConnectedAccountView } from '../connector-service/actions';
import type { TenantTransaction } from '../foundation/database';
import { ingestAiRuntimeEvent } from './repository';
import { SupplierUnavailableError } from '../zernio/client';

export interface ClaimedJob {
  id: string;
  workspaceId: string;
  runId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempt: number;
}

export interface RunWorkerDatabase {
  withWorkspace<T>(workspaceId: string, operation: (tx: TenantTransaction) => Promise<T>): Promise<T>;
  claimNextJob(workerName: string): Promise<ClaimedJob | undefined>;
}

export interface RunWorkerAiRuntime {
  prepareAnnouncement(payload: Record<string, unknown>): Promise<{ aiRunId: string; status: 'accepted' }>;
  getAnnouncementRun(aiRunId: string): Promise<{
    aiRunId: string;
    platformRunId: string;
    workspaceId: string;
    status: 'accepted' | 'running' | 'succeeded' | 'failed';
    result?: Record<string, unknown>;
    error?: string;
  }>;
  classifyItems(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  generateInsightReport(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Module 2：主题 taxonomy 提议（抽样归纳，不产出计数）。与 zernio 同为可选协作方。 */
  proposeTopics?(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Module 2：单 chunk 主题指派（固定 taxonomy，逐字证据）。 */
  assignTopics?(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface RunWorkerZernio {
  executeAction(idempotencyKey: string, action: ActionPlan['actions'][number], workspaceId?: string): Promise<unknown>;
}

export interface RunWorkerOptions {
  workerName: string;
  database: RunWorkerDatabase;
  aiRuntime: RunWorkerAiRuntime;
  zernio?: RunWorkerZernio;
  stripeSecretKey?: string;
  /** Resend 配置（迭代 4 报告外发）；缺省时 email 渠道投递会失败并重试。 */
  email?: ReportEmailConfig;
}

/** 分类 chunk 的幂等计费键：同一批 item 重试产生同一 attempt，不重复扣费。 */
function chunkAttemptKey(itemIds: string[]): number {
  const digest = createHash('sha256').update(itemIds.join(',')).digest();
  return (digest.readUInt32BE(0) % 2_000_000_000) + 1;
}

/**
 * A bounded worker service.  It has no process lifecycle of its own so it can
 * be driven by a CLI loop today or an Egg scheduled worker after migration.
 * Database job claiming remains the global coordination mechanism.
 */
export class RunWorker {
  constructor(private readonly options: RunWorkerOptions) {}

  async runOne(): Promise<boolean> {
    const job = await this.options.database.claimNextJob(this.options.workerName);
    if (!job) return false;
    try {
      if (job.kind === 'prepare_ai_run') await this.executePrepare(job);
      else if (job.kind === 'reconcile_ai_run') await this.reconcileAiRun(job);
      else if (job.kind === 'execute_approved_actions') await this.executeApprovedActions(job);
      else if (job.kind === 'issue_referral_credit') await this.issueReferralCredit(job);
      else if (job.kind === 'clawback_referral_credit') await this.clawbackReferralCredit(job);
      else if (job.kind === 'import.classify') await this.classifyImport(job);
      else if (job.kind === 'insight.generate') await this.generateInsight(job);
      else if (job.kind === 'insight.deliver') await this.deliverInsight(job);
      else if (job.kind === 'topics.cluster') await this.clusterTopics(job);
      else throw new Error(`Unsupported job: ${job.kind}`);
    } catch (error) {
      if (error instanceof SupplierUnavailableError) await this.deferForSupplier(job, error);
      else await this.failJob(job, error);
    }
    return true;
  }

  async drain(maxJobs: number): Promise<number> {
    let processed = 0;
    while (processed < maxJobs && await this.runOne()) processed += 1;
    return processed;
  }

  private async executePrepare(job: ClaimedJob): Promise<void> {
    if (!job.runId) throw new Error('prepare_ai_run is missing runId');
    const prepared = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      const result = await tx.query<{ id: string; input: Record<string, unknown>; context: BrandContextSnapshot; requestedBy: string; definition: unknown }>(
        `SELECT r.id, r.input, r.context_snapshot AS context, r.requested_by AS "requestedBy", v.definition
         FROM workflow_run r JOIN workflow_version v ON v.workflow_id = r.workflow_id AND v.version = r.workflow_version
         WHERE r.id = $1 AND r.workspace_id = $2`,
        [job.runId, job.workspaceId],
      );
      const found = result.rows[0];
      if (!found) throw new Error('Run not found');
      if (!isAnnouncementWorkflow(found.definition)) throw new Error('Workflow execution is not supported');
      // 对话框档位选择：run input 可携带 modelBand（eco/standard/flagship），
      // 合法且在品牌策略允许范围内时优先于默认档位。
      const requestedBand = z.enum(MODEL_BANDS).safeParse(found.input?.modelBand);
      const reservation = await reserveAiRun(tx, found.context.allowedModelClasses, found.id, requestedBand.success ? requestedBand.data : undefined);
      if (!reservation.replayed && reservation.guardrail.status === 'paused') {
        await this.pauseForBilling(tx, job, reservation.guardrail, 'ai_run');
        return undefined;
      }
      if (reservation.guardrail.status === 'degraded') {
        await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, event_key) DO NOTHING', [job.workspaceId, found.id, `billing:${found.id}:degraded`, 'billing.degraded', { provider: reservation.provider, modelBand: reservation.band }]);
        await tx.query('INSERT INTO audit_event (workspace_id, run_id, event_type, payload) VALUES ($1, $2, $3, $4)', [job.workspaceId, found.id, 'billing.degraded', { provider: reservation.provider, modelBand: reservation.band }]);
      }
      await tx.query("UPDATE workflow_run SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'queued')", [found.id, job.workspaceId]);
      if (reservation.guardrail.status === 'approval_required') await this.recordApprovalRequirement(tx, found.id, reservation.guardrail, 'ai_run');
      return { run: found, reservation };
    });
    if (!prepared) return;
    const { run, reservation } = prepared;

    const accepted = await this.options.aiRuntime.prepareAnnouncement({
      platformRunId: run.id,
      workspaceId: job.workspaceId,
      actorId: run.requestedBy,
      input: run.input,
      executionContext: toAiExecutionContext(run.context, reservation),
    });
    await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, event_key) DO NOTHING', [job.workspaceId, run.id, `ai:${accepted.aiRunId}:accepted`, 'ai_run.accepted', accepted]);
      // Event callbacks are best-effort. Persist a reconciliation job so a
      // transient callback failure cannot leave the platform run in `running`.
      await tx.query(
        "INSERT INTO job (workspace_id, run_id, kind, payload, available_at) VALUES ($1, $2, 'reconcile_ai_run', $3, now() + interval '10 seconds')",
        [job.workspaceId, run.id, { aiRunId: accepted.aiRunId }],
      );
      await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
    });
  }

  private async reconcileAiRun(job: ClaimedJob): Promise<void> {
    if (!job.runId) throw new Error('reconcile_ai_run is missing runId');
    const aiRunId = job.payload.aiRunId;
    if (typeof aiRunId !== 'string' || !aiRunId) throw new Error('reconcile_ai_run is missing aiRunId');
    const aiRun = await this.options.aiRuntime.getAnnouncementRun(aiRunId);
    if (aiRun.aiRunId !== aiRunId || aiRun.platformRunId !== job.runId || aiRun.workspaceId !== job.workspaceId) {
      throw new Error('AI runtime reconciliation returned a mismatched run');
    }
    if (aiRun.status === 'accepted' || aiRun.status === 'running') {
      await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        // Polling is normal work, not a failed attempt. Keep the durable job
        // alive until the runtime reaches a terminal state.
        await tx.query(
          "UPDATE job SET status = 'queued', attempt = GREATEST(attempt - 1, 0), available_at = now() + interval '10 seconds', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2",
          [job.id, job.workspaceId],
        );
      });
      return;
    }

    const event: AiRuntimeEvent = aiRun.status === 'succeeded'
      ? {
          eventId: `reconcile:${aiRunId}:action-plan`,
          platformRunId: job.runId,
          workspaceId: job.workspaceId,
          aiRunId,
          type: 'action_plan.created',
          createdAt: new Date().toISOString(),
          payload: { actionPlan: aiRun.result?.actionPlan },
        }
      : {
          eventId: `reconcile:${aiRunId}:failed`,
          platformRunId: job.runId,
          workspaceId: job.workspaceId,
          aiRunId,
          type: 'ai_run.failed',
          createdAt: new Date().toISOString(),
          payload: { error: aiRun.error ?? 'AI runtime failed' },
    };
    await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      const delivered = await tx.query<{ id: string }>(
        "SELECT id FROM run_event WHERE run_id = $1 AND event_type = $2 AND payload->>'aiRunId' = $3 LIMIT 1",
        [job.runId, event.type, aiRunId],
      );
      if (!delivered.rows[0]) await ingestAiRuntimeEvent(tx, event);
      await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
    });
  }

  private async executeApprovedActions(job: ClaimedJob): Promise<void> {
    if (!job.runId) throw new Error('execute_approved_actions is missing runId');
    const actionPlan = actionPlanSchema.parse(job.payload.actionPlan) as ActionPlan;
    if (actionPlan.blockedByCompliance) {
      throw new Error('Refusing to execute an action plan blocked by compliance');
    }
    for (const action of actionPlan.actions) {
      const operation = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        const run = await tx.query<{ status: string }>('SELECT status FROM workflow_run WHERE id = $1 AND workspace_id = $2', [job.runId, job.workspaceId]);
        if (!run.rows[0] || !['queued', 'running'].includes(run.rows[0].status)) throw new Error('Run is not ready for action execution');
        const guardrail = await projectedActionUsage(tx, { actionType: action.type, platform: action.platform, payload: action });
        if (guardrail.status === 'paused') {
          await this.pauseForBilling(tx, job, guardrail, 'publish');
          return { halted: true };
        }
        if (guardrail.status === 'approval_required') {
          const event = await tx.query<{ id: string }>('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, event_key) DO NOTHING RETURNING id', [job.workspaceId, job.runId, `billing:${job.runId}:approval_required`, 'billing.approval_required', guardrail]);
          if (event.rows[0]) {
            await tx.query("UPDATE workflow_run SET status = 'waiting_approval' WHERE id = $1 AND workspace_id = $2", [job.runId, job.workspaceId]);
            await tx.query('INSERT INTO approval_request (workspace_id, run_id, status, requested_action) VALUES ($1, $2, \'pending\', $3)', [job.workspaceId, job.runId, actionPlan]);
            await tx.query('INSERT INTO audit_event (workspace_id, run_id, event_type, payload) VALUES ($1, $2, $3, $4)', [job.workspaceId, job.runId, 'billing.approval_required', guardrail]);
            await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
            return { halted: true };
          }
        }
        const stepKey = `action:${action.stepOrder}`;
        await tx.query(`INSERT INTO step_run (workspace_id, run_id, step_key, status, input, started_at)
          VALUES ($1, $2, $3, 'running', $4, now()) ON CONFLICT (run_id, step_key, attempt) DO NOTHING`, [job.workspaceId, job.runId, stepKey, action]);
        const step = await tx.query<{ id: string; status: string }>('SELECT id, status FROM step_run WHERE run_id = $1 AND step_key = $2 AND attempt = 1', [job.runId, stepKey]);
        const stepRun = step.rows[0];
        if (!stepRun) throw new Error('Action step was not created');
        if (stepRun.status === 'succeeded') return undefined;

        const account = await tx.query<{ id: string; workspaceId: string; status: ConnectedAccountView['status']; capabilities: string[] }>(
          `SELECT a.id, a.workspace_id AS "workspaceId", a.status, a.capabilities
             FROM connected_account a
             JOIN zernio_tenant t ON t.workspace_id = a.workspace_id AND t.profile_id = a.zernio_profile_id
            WHERE a.workspace_id = $1 AND a.provider = 'zernio' AND a.external_account_id = $2`,
          [job.workspaceId, action.accountId],
        );
        const connected = account.rows[0];
        if (!connected) throw new Error('Connected Zernio account was not found in this workspace');
        return { stepRunId: stepRun.id, connected, action };
      });
      if (!operation) continue;
      if ('halted' in operation) return;
      const { zernio } = this.options;
      if (!zernio) throw new Error('Zernio action execution is not configured');
      const account: ConnectedAccountView = {
        id: operation.connected.id,
        workspaceId: operation.connected.workspaceId,
        status: operation.connected.status,
        capabilities: operation.connected.capabilities,
      };
      assertExecutableAction({ workspaceId: job.workspaceId, runId: job.runId, stepId: operation.stepRunId, attempt: 1, account, type: operation.action.type, payload: operation.action });
      const result = await zernio.executeAction(operation.action.idempotencyKey, operation.action, job.workspaceId);
      await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        await tx.query("UPDATE step_run SET status = 'succeeded', output = $2, finished_at = now() WHERE id = $1 AND workspace_id = $3", [operation.stepRunId, result, job.workspaceId]);
        await recordSuccessfulAction(tx, { runId: job.runId!, stepRunId: operation.stepRunId, actionType: operation.action.type, platform: operation.action.platform, payload: operation.action });
      });
    }
    await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      await tx.query("UPDATE workflow_run SET status = 'succeeded', finished_at = now() WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'running')", [job.runId, job.workspaceId]);
      await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
    });
  }

  private async issueReferralCredit(job: ClaimedJob): Promise<void> {
    const invoiceId = job.payload.invoiceId;
    if (typeof invoiceId !== 'string' || !invoiceId) throw new Error('Referral credit job is missing invoiceId');
    const credit = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      const result = await tx.query<{ amountMicros: string; currency: string; customerId: string | null }>(`
        SELECT l.amount_micros::text AS "amountMicros", l.currency, b.stripe_customer_id AS "customerId"
          FROM referral_credit_ledger l
          JOIN workspace_billing b ON b.workspace_id = l.workspace_id
         WHERE l.workspace_id = current_setting('app.workspace_id')::uuid
           AND l.stripe_invoice_id = $1 AND l.status = 'pending' AND l.available_at <= now()`, [invoiceId]);
      return result.rows[0];
    });
    if (!credit?.customerId) {
      await this.options.database.withWorkspace(job.workspaceId, (tx) => tx.query(
        "UPDATE job SET status = 'queued', attempt = GREATEST(attempt - 1, 0), available_at = now() + interval '1 day', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2",
        [job.id, job.workspaceId],
      ));
      return;
    }
    if (!this.options.stripeSecretKey) throw new Error('Stripe is not configured for referral credit issuance');
    const cents = Math.floor(Number(credit.amountMicros) / 10_000);
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Referral credit amount is invalid');
    const response = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(credit.customerId)}/balance_transactions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.stripeSecretKey}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `referral-credit:${invoiceId}` },
      body: new URLSearchParams({ amount: String(-cents), currency: credit.currency, description: `Piggybot referral credit for ${invoiceId}`, 'metadata[referral_invoice_id]': invoiceId }),
    });
    const body = await response.json().catch(() => ({})) as { id?: unknown };
    if (!response.ok || typeof body.id !== 'string') throw new Error('Stripe customer balance credit failed');
    await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      await tx.query("UPDATE referral_credit_ledger SET status = 'available', stripe_balance_txn = $2 WHERE workspace_id = current_setting('app.workspace_id')::uuid AND stripe_invoice_id = $1 AND status = 'pending'", [invoiceId, body.id]);
      await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
    });
  }

  private async clawbackReferralCredit(job: ClaimedJob): Promise<void> {
    const invoiceId = job.payload.invoiceId;
    if (typeof invoiceId !== 'string' || !invoiceId || !this.options.stripeSecretKey) throw new Error('Referral clawback is not configured');
    const credit = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      const result = await tx.query<{ amountMicros: string; currency: string; customerId: string | null }>(`
        SELECT l.amount_micros::text AS "amountMicros", l.currency, b.stripe_customer_id AS "customerId"
          FROM referral_credit_ledger l JOIN workspace_billing b ON b.workspace_id = l.workspace_id
         WHERE l.workspace_id = current_setting('app.workspace_id')::uuid AND l.stripe_invoice_id = $1 AND l.status = 'clawed_back'`, [invoiceId]);
      return result.rows[0];
    });
    if (!credit?.customerId) throw new Error('Referral clawback customer is unavailable');
    const cents = Math.floor(Number(credit.amountMicros) / 10_000);
    const response = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(credit.customerId)}/balance_transactions`, {
      method: 'POST', headers: { authorization: `Bearer ${this.options.stripeSecretKey}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `referral-clawback:${invoiceId}` },
      body: new URLSearchParams({ amount: String(cents), currency: credit.currency, description: `Piggybot referral reversal for ${invoiceId}` }),
    });
    if (!response.ok) throw new Error('Stripe referral clawback failed');
    await this.options.database.withWorkspace(job.workspaceId, (tx) => tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]));
  }

  private async classifyImport(job: ClaimedJob): Promise<void> {
    const batchId = job.payload.batchId;
    if (typeof batchId !== 'string' || !batchId) throw new Error('import.classify is missing batchId');

    // Chunked synchronous classification; each chunk writes tags transactionally
    // so a mid-batch failure can be retried without duplicating rows (UNIQUE item+tag).
    const CLASSIFY_CHUNK = 50;
    // Commit only complete chunks. Partial results leave the same item IDs
    // pending, so bounded job retries reuse the original paid reservation.
    for (;;) {
      const items = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        const batch = await tx.query<{ status: string; modelBand: string }>(
          `UPDATE import_batch SET status = 'classifying'
            WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status IN ('pending', 'classifying')
            RETURNING status, model_band AS "modelBand"`,
          [batchId],
        );
        if (!batch.rows[0]) throw new Error('import batch not found or already terminal');
        const pending = await tx.query<{ id: string; text: string; author: string | null; platform: string }>(
          `SELECT i.id, i.text, i.author, i.platform
             FROM import_item i
            WHERE i.batch_id = $1 AND i.workspace_id = current_setting('app.workspace_id')::uuid
              AND i.classified_at IS NULL
            ORDER BY i.created_at, i.id
            LIMIT $2`,
          [batchId, CLASSIFY_CHUNK],
        );
        if (!pending.rows.length) return { deferred: false as const, modelBand: batch.rows[0].modelBand as ModelBand, rows: pending.rows };
        // 迭代 5：按 chunk 计量 AI credits。attempt 取 chunk 内容哈希 —— 同一批
        // item 重试不会重复扣费（task_event 幂等索引 ON CONFLICT DO NOTHING）；
        // 额度暂停时延迟 job 而非失败（与 referral credit 的 deferral 同模式），
        // 充值/账期重置后自动续跑，已分类 chunk 不会重做。
        const reservation = await reserveAiRun(
          tx,
          [batch.rows[0].modelBand],
          { subjectId: batchId, attempt: chunkAttemptKey(pending.rows.map((row) => row.id)), actionType: 'ai.classify' },
          batch.rows[0].modelBand as ModelBand,
        );
        if (!reservation.replayed && reservation.guardrail.status === 'paused') {
          await this.deferJobForCredits(tx, job, 'import.classify_deferred', { batchId });
          return { deferred: true as const };
        }
        return { deferred: false as const, modelBand: reservation.band, provider: reservation.provider, rows: pending.rows };
      });

      if (items.deferred) return;

      if (!items.rows.length) {
        await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
          await tx.query(
            "UPDATE import_batch SET status = 'classified', classified_at = now() WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid",
            [batchId],
          );
          // 批次级覆盖率指标：打标条目占比（区分"有信号"与"无信号/放弃"的规模）。
          const statsRow = await tx.query<{ items: string | number; tagged: string | number }>(
            `SELECT COUNT(DISTINCT i.id) AS items, COUNT(DISTINCT t.item_id) AS tagged
               FROM import_item i LEFT JOIN item_tag t ON t.item_id = i.id
              WHERE i.batch_id = $1 AND i.workspace_id = current_setting('app.workspace_id')::uuid`,
            [batchId],
          );
          const itemCount = Number(statsRow.rows[0]?.items ?? 0);
          const taggedItems = Number(statsRow.rows[0]?.tagged ?? 0);
          await tx.query(
            'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
            [job.workspaceId, 'import.classified', { batchId, items: itemCount, taggedItems, tagCoverageRate: itemCount ? taggedItems / itemCount : 1 }],
          );
          await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
        });
        return;
      }

      const result = await this.options.aiRuntime.classifyItems({
        modelBand: items.modelBand,
        // 计费预订决定的供应商路由必须透传（审核 #5）：degraded 状态记录的
        // 是 fallback，runtime 不能再硬编码 primary。
        provider: items.provider,
        items: items.rows.map((row, index) => ({ index, text: row.text, author: row.author ?? undefined, platform: row.platform })),
      });

      const assignments = validatedClassifications(result, items.rows);
      await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        // Index completeness and all quotes have already been checked.
        // Empty tags mean explicitly no signal, never a missing assignment.
        for (const assignment of assignments) {
          const item = items.rows[assignment.itemIndex]!;
          if (assignment.sentiment) {
            await tx.query(
              "UPDATE import_item SET sentiment = $2::jsonb WHERE id = $1 AND batch_id = $3 AND workspace_id = current_setting('app.workspace_id')::uuid",
              [item.id, JSON.stringify(assignment.sentiment), batchId],
            );
          }
          for (const tag of assignment.tags) {
            await tx.query(
              `INSERT INTO item_tag (workspace_id, item_id, tag, confidence, evidence, model_band)
               VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5)
               ON CONFLICT (item_id, tag) DO NOTHING`,
              [item.id, tag.tag, tag.confidence, tag.evidence, items.modelBand],
            );
          }
        }
        await tx.query(
          `UPDATE import_item SET classified_at = now()
            WHERE batch_id = $1 AND id = ANY($2::uuid[])`,
          [batchId, items.rows.map(item => item.id)],
        );
      });
    }
  }

  /**
   * Module 2：全量主题聚类。一个 job 驱动一次运行直到完成：
   * propose（一次，≤200 条抽样归纳 taxonomy）→ assign（50 条/chunk 循环，
   * 按 chunk 幂等计费）→ 平台侧 SQL COUNT 回填确定计数。
   * 进度标记在 import_item.topic_assigned_run：重试跳过已完成 chunk；
   * 死信后管理员重放可从断点续跑（taxonomy 已存在则直接进指派阶段）。
   */
  private async clusterTopics(job: ClaimedJob): Promise<void> {
    const runId = job.payload.runId;
    if (typeof runId !== 'string' || !runId) throw new Error('topics.cluster is missing runId');
    if (!this.options.aiRuntime.proposeTopics || !this.options.aiRuntime.assignTopics) throw new Error('topics_runtime_unavailable');

    const state = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      const run = await tx.query<{ status: string; modelBand: string; topicCount: string | number }>(
        `SELECT r.status, r.model_band AS "modelBand",
                (SELECT COUNT(*) FROM topic t WHERE t.run_id = r.id) AS "topicCount"
           FROM topic_run r
          WHERE r.id = $1 AND r.workspace_id = current_setting('app.workspace_id')::uuid`,
        [runId],
      );
      return run.rows[0];
    });
    if (!state) throw new Error('topic run not found');
    if (state.status === 'completed') {
      // 幂等：运行已完成（重试/重放），直接收尾 job。
      await this.options.database.withWorkspace(job.workspaceId, (tx) => tx.query(
        "UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2",
        [job.id, job.workspaceId],
      ));
      return;
    }

    // 阶段 1：taxonomy 提议（仅当尚无主题时执行；attempt=1 重放不重复扣费）。
    if (!Number(state.topicCount)) {
      const proposal = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        const claimed = await tx.query<{ modelBand: string }>(
          `UPDATE topic_run SET status = 'proposing', error = NULL
            WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid
              AND status IN ('pending', 'proposing', 'failed')
            RETURNING model_band AS "modelBand"`,
          [runId],
        );
        if (!claimed.rows[0]) throw new Error('topic run not found or already terminal');
        const reservation = await reserveAiRun(
          tx,
          [claimed.rows[0].modelBand],
          { subjectId: runId, attempt: 1, actionType: 'ai.topics.propose' },
          claimed.rows[0].modelBand as ModelBand,
        );
        if (!reservation.replayed && reservation.guardrail.status === 'paused') {
          await this.deferJobForCredits(tx, job, 'topics.cluster_deferred', { runId, phase: 'propose' });
          return { deferred: true as const };
        }
        // 抽样只决定 taxonomy 的形状；计数永远来自平台侧 SQL。
        const sample = await tx.query<{ id: string; text: string; platform: string }>(
          `SELECT id, text, platform FROM import_item
            WHERE workspace_id = current_setting('app.workspace_id')::uuid AND classified_at IS NOT NULL
            ORDER BY created_at DESC, id
            LIMIT $1`,
          [TOPIC_PROPOSE_SAMPLE],
        );
        if (!sample.rows.length) throw new Error('topics_no_classified_items');
        return { deferred: false as const, modelBand: reservation.band, provider: reservation.provider, sample: sample.rows };
      });
      if (proposal.deferred) return;

      const proposed = await this.options.aiRuntime.proposeTopics({
        modelBand: proposal.modelBand,
        provider: proposal.provider,
        items: proposal.sample.map((row, index) => ({ index, text: row.text, platform: row.platform })),
      });
      const taxonomy = validatedTopicTaxonomy(proposed);
      await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        for (const entry of taxonomy) {
          await tx.query(
            `INSERT INTO topic (workspace_id, run_id, topic_key, label, description)
             VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4)
             ON CONFLICT (run_id, topic_key) DO NOTHING`,
            [runId, entry.key, entry.label, entry.description],
          );
        }
        await tx.query(
          `UPDATE topic_run SET status = 'assigning', topic_count = $2
            WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`,
          [runId, taxonomy.length],
        );
      });
    } else if (state.status !== 'assigning') {
      // 断点续跑（含死信重放）：taxonomy 已就绪，直接进入指派阶段。
      await this.options.database.withWorkspace(job.workspaceId, (tx) => tx.query(
        `UPDATE topic_run SET status = 'assigning', error = NULL
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status IN ('pending', 'proposing', 'failed')`,
        [runId],
      ));
    }

    // 阶段 2：分块指派，直到没有未处理条目。与 import.classify 同一模式：
    // 每个 chunk 完整落库后才推进进度标记，中途失败重试不重做已付 chunk。
    for (;;) {
      const chunk = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        const run = await tx.query<{ status: string; modelBand: string }>(
          `SELECT status, model_band AS "modelBand" FROM topic_run
            WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`,
          [runId],
        );
        if (run.rows[0]?.status !== 'assigning') throw new Error('topic run not in assigning state');
        const taxonomy = await tx.query<{ id: string; key: string; label: string; description: string }>(
          `SELECT id, topic_key AS key, label, description FROM topic
            WHERE run_id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid
            ORDER BY topic_key`,
          [runId],
        );
        const pending = await tx.query<{ id: string; text: string; platform: string }>(
          `SELECT id, text, platform FROM import_item
            WHERE workspace_id = current_setting('app.workspace_id')::uuid
              AND classified_at IS NOT NULL
              AND (topic_assigned_run IS NULL OR topic_assigned_run <> $1)
            ORDER BY created_at, id
            LIMIT $2`,
          [runId, TOPIC_ASSIGN_CHUNK],
        );
        if (!pending.rows.length) return { done: true as const };
        const reservation = await reserveAiRun(
          tx,
          [run.rows[0].modelBand],
          { subjectId: runId, attempt: chunkAttemptKey(pending.rows.map((row) => row.id)), actionType: 'ai.topics.assign' },
          run.rows[0].modelBand as ModelBand,
        );
        if (!reservation.replayed && reservation.guardrail.status === 'paused') {
          await this.deferJobForCredits(tx, job, 'topics.cluster_deferred', { runId, phase: 'assign' });
          return { done: false as const, deferred: true as const };
        }
        return { done: false as const, deferred: false as const, modelBand: reservation.band, provider: reservation.provider, taxonomy: taxonomy.rows, rows: pending.rows };
      });

      if ('deferred' in chunk && chunk.deferred) return;

      if (chunk.done) {
        await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
          // 确定计数回填：唯一权威来源是 item_topic 行数，LLM 无从编造。
          await tx.query(
            `UPDATE topic SET item_count = (SELECT COUNT(*) FROM item_topic WHERE item_topic.topic_id = topic.id)
              WHERE run_id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`,
            [runId],
          );
          const finalized = await tx.query<{ items: string | number; topics: string | number }>(
            `UPDATE topic_run SET status = 'completed', completed_at = now(),
                    item_count = (SELECT COUNT(*) FROM import_item
                                   WHERE workspace_id = current_setting('app.workspace_id')::uuid AND topic_assigned_run = $1)
              WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid
              RETURNING item_count AS items, topic_count AS topics`,
            [runId],
          );
          await tx.query(
            'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
            [job.workspaceId, 'topics.clustered', { runId, items: Number(finalized.rows[0]?.items ?? 0), topics: Number(finalized.rows[0]?.topics ?? 0) }],
          );
          await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
        });
        return;
      }

      const assigned = await this.options.aiRuntime.assignTopics({
        modelBand: chunk.modelBand,
        provider: chunk.provider,
        taxonomy: chunk.taxonomy.map((row) => ({ key: row.key, label: row.label, description: row.description })),
        items: chunk.rows.map((row, index) => ({ index, text: row.text, platform: row.platform })),
      });
      const assignments = validatedTopicAssignments(assigned, chunk.rows, new Set(chunk.taxonomy.map((row) => row.key)));
      const topicIdByKey = new Map(chunk.taxonomy.map((row) => [row.key, row.id]));
      await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        for (const assignment of assignments) {
          const item = chunk.rows[assignment.itemIndex]!;
          for (const topicRef of assignment.topics) {
            await tx.query(
              `INSERT INTO item_topic (workspace_id, run_id, item_id, topic_id, confidence, evidence, model_band)
               VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5, $6)
               ON CONFLICT (run_id, item_id, topic_id) DO NOTHING`,
              [runId, item.id, topicIdByKey.get(topicRef.key)!, topicRef.confidence, topicRef.evidence, chunk.modelBand],
            );
          }
        }
        // 零指派条目同样标记已处理，否则会被无限重取。
        await tx.query(
          `UPDATE import_item SET topic_assigned_run = $1
            WHERE id = ANY($2::uuid[]) AND workspace_id = current_setting('app.workspace_id')::uuid`,
          [runId, chunk.rows.map((row) => row.id)],
        );
      });
    }
  }

  private async generateInsight(job: ClaimedJob): Promise<void> {
    const reportId = job.payload.reportId;
    if (typeof reportId !== 'string' || !reportId) throw new Error('insight.generate is missing reportId');

    // 1. 领取报告（状态守卫防重复消费）并聚合确定性证据包。
    const prepared = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      const report = await tx.query<{ template: string; modelBand: string; batchIds: string[] }>(
        `UPDATE insight_report SET status = 'generating', error = NULL
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status IN ('pending', 'generating')
          RETURNING template, model_band AS "modelBand", batch_ids AS "batchIds"`,
        [reportId],
      );
      const reportRow = report.rows[0];
      if (!reportRow) throw new Error('insight report not found or already terminal');
      const template = insightTemplateSchema.parse(reportRow.template);
      // 迭代 5：每份报告按档位计量一次 AI credits（attempt=1，幂等去重 ——
      // job 重试不会重复扣费）；额度暂停时延迟 job，充值/账期重置后自动续跑。
      const reservation = await reserveAiRun(
        tx,
        [reportRow.modelBand],
        { subjectId: reportId, actionType: 'ai.insight' },
        reportRow.modelBand as ModelBand,
      );
      if (!reservation.replayed && reservation.guardrail.status === 'paused') {
        await this.deferJobForCredits(tx, job, 'insight.generate_deferred', { reportId });
        return { deferred: true as const };
      }
      const items = await tx.query<EvidenceSourceRow>(
        `SELECT i.id, i.platform, i.author, i.text, i.metrics, i.sentiment,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('tag', t.tag, 'evidence', t.evidence, 'confidence', t.confidence::float8))
                            FROM item_tag t WHERE t.item_id = i.id), '[]'::jsonb) AS tags
           FROM import_item i
          WHERE i.batch_id = ANY($1::uuid[]) AND i.workspace_id = current_setting('app.workspace_id')::uuid
          ORDER BY i.created_at, i.id`,
        [reportRow.batchIds],
      );
      // 每日运营任务是洞察聚合调度器：附带近期已生成报告的摘要作为决策输入。
      let priorReports: Array<{ ref: string; template: string; title: string; summary: string }> | undefined;
      if (template === 'daily_ops') {
        const prior = await tx.query<{ template: string; title: string; summary: string | null }>(
          `SELECT template, title, report->>'summary' AS summary
             FROM insight_report
            WHERE workspace_id = current_setting('app.workspace_id')::uuid
              AND status = 'generated' AND id <> $1
            ORDER BY created_at DESC LIMIT 4`,
          [reportId],
        );
        priorReports = prior.rows.filter((row) => row.summary).map((row, index) => ({ ref: `p${index + 1}`, template: row.template, title: row.title, summary: row.summary! }));
      }
      return { deferred: false as const, template, modelBand: reservation.band, provider: reservation.provider, pack: buildEvidencePack(items.rows), priorReports, fullTextById: new Map(items.rows.map((row) => [row.id, row.text])) };
    });
    if (prepared.deferred) return;

    // 引用校验对照原文全文（证据包内文本被截断到 600 字符，snippet 可能落在截断点之后）。
    const textByRef = new Map<string, string>();
    for (const [ref, itemId] of Object.entries(prepared.pack.refMap)) {
      const fullText = prepared.fullTextById.get(itemId);
      if (fullText !== undefined) textByRef.set(ref, fullText);
    }
    // Daily tasks may cite a supplied prior summary explicitly. This is a
    // secondary source, preserved separately from original comment evidence.
    for (const prior of prepared.priorReports ?? []) textByRef.set(prior.ref, prior.summary);

    // 2. LLM 生成；schema 非法 → 抛错走 job 重试（与 import.classify 同一语义）。
    const result = await this.options.aiRuntime.generateInsightReport({
      template: prepared.template,
      modelBand: prepared.modelBand,
      provider: prepared.provider,
      totals: prepared.pack.totals,
      topItems: prepared.pack.topItems,
      tagSamples: prepared.pack.tagSamples,
      ...(prepared.pack.memberStats ? { memberStats: prepared.pack.memberStats } : {}),
      ...(prepared.priorReports?.length ? { priorReports: prepared.priorReports } : {}),
    });
    const schema = insightResultSchemas[prepared.template as InsightTemplate];
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new Error(`insight result failed schema validation: ${parsed.error.issues.length} issue(s)`);

    // 3. 引用硬校验：幻觉引用（ref 未知 / snippet 非逐字）一律丢弃并计数。
    const stats = { dropped: 0 };
    const validated = validateReportCitations(parsed.data, textByRef, stats);
    // Apply the same quotation gate to all six templates, including daily ops.
    const grounding: GroundingStats = { totalConclusions: 0, groundedConclusions: 0, droppedConclusions: 0 };
    const groundedReport = enforceGroundedConclusions(validated, grounding);
    const acceptanceIssues = templateAcceptanceIssues(prepared.template, groundedReport as Record<string, unknown>);
    if (grounding.groundedConclusions === 0 || acceptanceIssues.length) {
      const error = grounding.groundedConclusions === 0
        ? 'insufficient_grounded_evidence: no conclusion is backed by verbatim evidence'
        : `template_acceptance_failed: ${acceptanceIssues.join('; ')}. Add relevant sources or revise the brief; no filler was generated.`;
      await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        await tx.query(
          `UPDATE insight_report SET status = 'failed', error = $3
             WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generating'`,
          [reportId, job.workspaceId, error],
        );
        await tx.query(
          'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
          [job.workspaceId, grounding.groundedConclusions === 0 ? 'insight.insufficient_evidence' : 'insight.acceptance_failed', { reportId, template: prepared.template, acceptanceIssues, droppedCitations: stats.dropped, droppedConclusions: grounding.droppedConclusions, totalConclusions: grounding.totalConclusions }],
        );
        await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
      });
      return;
    }
    const validatedReport = schema.parse(groundedReport);
    const cleaned = prepared.template === 'review_attribution'
      ? rankReviewReport(insightResultSchemas.review_attribution.parse(validatedReport), new Map(prepared.pack.topItems.filter(item => item.sku).map(item => [item.ref, item.sku!])))
      : validatedReport;
    const groundedRate = grounding.totalConclusions ? grounding.groundedConclusions / grounding.totalConclusions : 1;

    await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      await tx.query(
        `UPDATE insight_report
            SET status = 'generated', report = $3::jsonb, dropped_citations = $4, generated_at = now()
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generating'`,
        [reportId, job.workspaceId, JSON.stringify({
          ...cleaned,
          _evidence: prepared.pack.refMap,
          _priorEvidence: prepared.priorReports ?? [],
          _countBasis: 'distinct_cited_sources',
          // Calculated over ALL selected source rows before evidence sampling.
          // Never accept population statistics supplied by the model.
          _dataset: { ...prepared.pack.totals, sampledItems: prepared.pack.topItems.length },
          _metrics: { droppedCitations: stats.dropped, droppedConclusions: grounding.droppedConclusions, groundedConclusions: grounding.groundedConclusions, totalConclusions: grounding.totalConclusions, groundedRate },
        }), stats.dropped],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
        [job.workspaceId, 'insight.generated', { reportId, template: prepared.template, droppedCitations: stats.dropped, droppedConclusions: grounding.droppedConclusions, groundedRate }],
      );
      await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
    });
  }

  /**
   * 迭代 4（报告外发闭环）：审批通过后按 delivery 快照投递报告摘要。
   * 快照在 requestDelivery 时冻结（审批人看到什么就发什么）；只有
   * status='approved' 的快照才投递，重复入队/被拒后安全跳过。
   */
  private async deliverInsight(job: ClaimedJob): Promise<void> {
    const reportId = z.string().uuid().parse(job.payload.reportId);

    const prepared = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      const result = await tx.query<{ title: string; template: string; itemCount: number; droppedCitations: number; report: Record<string, unknown> | null; delivery: unknown }>(
        `SELECT title, template, item_count AS "itemCount", dropped_citations AS "droppedCitations", report, delivery
           FROM insight_report
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid`,
        [reportId],
      );
      const row = result.rows[0];
      if (!row?.report) throw new Error('insight report not found or not generated');
      const delivery = reportDeliverySchema.safeParse(row.delivery);
      if (!delivery.success) throw new Error('insight delivery snapshot is missing');
      if (delivery.data.status !== 'approved') return { skipped: true as const };
      if (!delivery.data.content || !delivery.data.subject) throw new Error('insight_delivery_requires_new_approval: legacy approval has no message snapshot');
      if (job.payload.approvalId !== delivery.data.approvalId) return { skipped: true as const };
      return {
        skipped: false as const,
        title: row.title,
        template: insightTemplateSchema.parse(row.template),
        itemCount: row.itemCount,
        droppedCitations: row.droppedCitations,
        report: row.report,
        delivery: delivery.data,
      };
    });
    if (prepared.skipped) {
      await this.options.database.withWorkspace(job.workspaceId, (tx) => tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]));
      return;
    }

    // 摘要是给人读的速览版，不引入报告之外的新事实；Discord 限 2000 字符。
    const digest = prepared.delivery.content!;
    if (prepared.delivery.channel === 'email') {
      if (!this.options.email) throw new Error('Email delivery is not configured');
      await sendReportEmail(this.options.email, {
        to: prepared.delivery.target,
        subject: prepared.delivery.subject!,
        text: digest,
        idempotencyKey: `insight-delivery/${prepared.delivery.approvalId}`,
      });
    } else {
      const { zernio } = this.options;
      if (!zernio) throw new Error('Zernio action execution is not configured');
      const account = await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        const result = await tx.query<{ id: string; workspaceId: string; status: ConnectedAccountView['status']; capabilities: string[]; externalAccountId: string }>(
          `SELECT id, workspace_id AS "workspaceId", status, capabilities, external_account_id AS "externalAccountId"
             FROM connected_account
            WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND provider = 'zernio'`,
          [prepared.delivery.target],
        );
        return result.rows[0];
      });
      if (!account) throw new Error('Delivery target account was not found in this workspace');
      const action = {
        stepOrder: 1,
        type: 'social.create_post' as const,
        platform: 'discord',
        accountId: account.externalAccountId,
        content: digest,
        hashtags: [] as string[],
        mode: 'publish_now' as const,
        idempotencyKey: `insight-delivery:${prepared.delivery.approvalId}`,
        requiresApproval: false,
      };
      assertExecutableAction({
        workspaceId: job.workspaceId,
        runId: reportId,
        stepId: job.id,
        attempt: Math.max(job.attempt, 1),
        account: { id: account.id, workspaceId: account.workspaceId, status: account.status, capabilities: account.capabilities },
        type: action.type,
        payload: action,
      });
      await zernio.executeAction(action.idempotencyKey, action, job.workspaceId);
    }

    await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      await tx.query(
        `UPDATE insight_report SET delivery = delivery || $3::jsonb
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND delivery->>'status' = 'approved' AND delivery->>'approvalId' = $4`,
        [reportId, job.workspaceId, JSON.stringify({ status: 'delivered', deliveredAt: new Date().toISOString() }), prepared.delivery.approvalId],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
        [job.workspaceId, 'insight.delivered', { reportId, approvalId: prepared.delivery.approvalId, channel: prepared.delivery.channel, targetLabel: prepared.delivery.targetLabel }],
      );
      await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
    });
  }

  private async pauseForBilling(tx: TenantTransaction, job: ClaimedJob, guardrail: UsageSnapshot, stage: 'ai_run' | 'publish'): Promise<void> {
    if (!job.runId) throw new Error('Billing pause is missing runId');
    const payload = { stage, guardrail, jobKind: job.kind, jobPayload: job.payload };
    await tx.query("UPDATE workflow_run SET status = 'waiting_approval' WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'queued', 'running')", [job.runId, job.workspaceId]);
    await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, event_key) DO NOTHING', [job.workspaceId, job.runId, `billing:${job.id}:paused`, 'billing.paused', payload]);
    await tx.query('INSERT INTO audit_event (workspace_id, run_id, event_type, payload) VALUES ($1, $2, $3, $4)', [job.workspaceId, job.runId, 'billing.paused', payload]);
    await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
  }

  private async recordApprovalRequirement(tx: TenantTransaction, runId: string, guardrail: UsageSnapshot, stage: 'ai_run' | 'publish'): Promise<void> {
    await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES (current_setting(\'app.workspace_id\')::uuid, $1, $2, $3, $4) ON CONFLICT (run_id, event_key) DO NOTHING', [runId, `billing:${runId}:approval_required`, 'billing.approval_required', { stage, guardrail }]);
    await tx.query('INSERT INTO audit_event (workspace_id, run_id, event_type, payload) VALUES (current_setting(\'app.workspace_id\')::uuid, $1, $2, $3)', [runId, 'billing.approval_required', { stage, guardrail }]);
  }

  private async failJob(job: ClaimedJob, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      const result = await tx.query<{ status: string }>("UPDATE job SET status = CASE WHEN attempt >= max_attempts THEN 'dead_lettered'::job_status ELSE 'queued'::job_status END, available_at = now() + interval '30 seconds', locked_at = NULL, locked_by = NULL, last_error = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING status", [job.id, job.workspaceId, message]);
      if (result.rows[0]?.status === 'dead_lettered' && job.runId) {
        await tx.query("UPDATE workflow_run SET status = 'dead_lettered', finished_at = now() WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'queued', 'running')", [job.runId, job.workspaceId]);
        await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (run_id, event_key) DO NOTHING', [job.workspaceId, job.runId, `job:${job.id}:dead_lettered`, 'run.dead_lettered', { error: message }]);
      }
      // 洞察报告无关联 workflow_run，死信时直接把报告置为 failed 供前端展示。
      if (result.rows[0]?.status === 'dead_lettered' && job.kind === 'insight.generate' && typeof job.payload.reportId === 'string') {
        await tx.query("UPDATE insight_report SET status = 'failed', error = $3 WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'generating')", [job.payload.reportId, job.workspaceId, message.slice(0, 500)]);
      }
      // 导入批次同理：死信后置为 failed，避免永远停在 classifying。
      if (result.rows[0]?.status === 'dead_lettered' && job.kind === 'import.classify' && typeof job.payload.batchId === 'string') {
        await tx.query("UPDATE import_batch SET status = 'failed' WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'classifying')", [job.payload.batchId, job.workspaceId]);
      }
      // 主题运行同理：死信后置为 failed（保留已落库的部分结果与错误）；
      // 管理员重放 job 时按 taxonomy 是否存在自动从断点续跑。
      if (result.rows[0]?.status === 'dead_lettered' && job.kind === 'topics.cluster' && typeof job.payload.runId === 'string') {
        await tx.query("UPDATE topic_run SET status = 'failed', error = $3 WHERE id = $1 AND workspace_id = $2 AND status IN ('pending', 'proposing', 'assigning')", [job.payload.runId, job.workspaceId, message.slice(0, 500)]);
      }
      // 报告外发死信：delivery 状态机置为 failed 供前端展示，可重新发起外发。
      if (result.rows[0]?.status === 'dead_lettered' && job.kind === 'insight.deliver' && typeof job.payload.reportId === 'string') {
        await tx.query("UPDATE insight_report SET delivery = COALESCE(delivery, '{}'::jsonb) || $3::jsonb WHERE id = $1 AND workspace_id = $2 AND (delivery->>'approvalId' = $4 OR ($4::text IS NULL AND NOT (delivery ? 'content')))", [job.payload.reportId, job.workspaceId, JSON.stringify({ status: 'failed', error: message.slice(0, 500) }), job.payload.approvalId ?? null]);
        await tx.query('INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)', [job.workspaceId, 'insight.delivery_failed', { reportId: job.payload.reportId, error: message.slice(0, 200) }]);
      }
    });
  }

  private async deferForSupplier(job: ClaimedJob, error: SupplierUnavailableError): Promise<void> {
    await this.options.database.withWorkspace(job.workspaceId, (tx) => tx.query(
      "UPDATE job SET status = 'queued', attempt = GREATEST(attempt - 1, 0), available_at = now() + interval '30 seconds', locked_at = NULL, locked_by = NULL, last_error = $3, updated_at = now() WHERE id = $1 AND workspace_id = $2",
      [job.id, job.workspaceId, error.message],
    ));
  }

  /**
   * 额度暂停时延迟 job 而非失败（与 referral credit deferral 同模式）：
   * 不消耗 attempt，6 小时后重试；充值或账期重置后自动续跑。
   * 必须在预订所在的同一租户事务内调用，保证状态原子性。
   */
  private async deferJobForCredits(tx: TenantTransaction, job: ClaimedJob, auditEvent: string, payload: Record<string, unknown>): Promise<void> {
    await tx.query('INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)', [job.workspaceId, auditEvent, payload]);
    await tx.query(
      "UPDATE job SET status = 'queued', attempt = GREATEST(attempt - 1, 0), available_at = now() + interval '6 hours', locked_at = NULL, locked_by = NULL, last_error = 'ai_credits_deferred', updated_at = now() WHERE id = $1 AND workspace_id = $2",
      [job.id, job.workspaceId],
    );
  }
}

function toAiExecutionContext(context: BrandContextSnapshot, reservation: AiReservation) {
  const policy = MODEL_BAND_POLICIES[reservation.band];
  return {
    brandProfile: {
      tone: context.tone,
      language: context.language,
      forbiddenWords: context.forbiddenWords,
    },
    priorApprovedExamples: [],
    // The 80% guardrail is deliberately enforced even when a workspace has
    // otherwise enabled auto-approval: the next publish must be explicitly approved.
    approvalPolicy: reservation.guardrail.status === 'approval_required' ? 'required' : context.approvalPolicy,
    runPolicy: {
      approvalRequiredForPublish: reservation.guardrail.status === 'approval_required' || context.approvalPolicy !== 'none',
      modelBand: reservation.band,
      llmProvider: reservation.provider,
      maxInputTokens: policy.maxInputTokens,
      maxOutputTokens: policy.maxOutputTokens,
      maxTargets: policy.maxTargets,
    },
  };
}

/**
 * Validates the ai-runtime classify payload. A malformed response throws so the
 * durable job retries (and dead-letters for admin replay) instead of silently
 * marking the chunk classified without tags.
 */
export function validatedClassifications(result: Record<string, unknown>, items: Array<{ text: string }>): TagAssignment[] {
  const parsed = classifyResultSchema.safeParse(result);
  if (!parsed.success) throw new Error(`classify result failed schema validation: ${parsed.error.issues.length} issue(s)`);
  const seen = new Set<number>();
  for (const assignment of parsed.data.assignments) {
    const item = items[assignment.itemIndex];
    if (!item || seen.has(assignment.itemIndex)) throw new Error('classification_invalid_item_index');
    seen.add(assignment.itemIndex);
    if (assignment.sentiment && !item.text.includes(assignment.sentiment.evidence)) {
      throw new Error('classification_invalid_sentiment_evidence');
    }
    const tags = new Set<string>();
    for (const tag of assignment.tags) {
      if (!item.text.includes(tag.evidence) || tags.has(tag.tag)) throw new Error('classification_invalid_evidence');
      tags.add(tag.tag);
    }
  }
  if (seen.size !== items.length) throw new Error('classification_incomplete: retry the complete paid chunk');
  return parsed.data.assignments;
}

/**
 * Validates the proposed topic taxonomy. Malformed output throws so the job
 * retries（attempt=1 重放已付预订，不重复扣费）instead of persisting a broken
 * taxonomy. Duplicate keys are rejected: assignment chunks reference by key.
 */
export function validatedTopicTaxonomy(result: Record<string, unknown>): TopicTaxonomyEntry[] {
  const parsed = topicProposeResultSchema.safeParse(result);
  if (!parsed.success) throw new Error(`topics propose result failed schema validation: ${parsed.error.issues.length} issue(s)`);
  const seen = new Set<string>();
  for (const entry of parsed.data.topics) {
    if (seen.has(entry.key)) throw new Error('topics_duplicate_key');
    seen.add(entry.key);
  }
  return parsed.data.topics;
}

/**
 * Validates one topic-assignment chunk with the same posture as
 * validatedClassifications: complete indexes, taxonomy-only keys, verbatim
 * evidence. A malformed chunk throws for retry — silently dropping it would
 * corrupt the verifiable per-topic counts.
 */
export function validatedTopicAssignments(result: Record<string, unknown>, items: Array<{ text: string }>, taxonomyKeys: Set<string>): TopicAssignmentResult['assignments'] {
  const parsed = topicAssignmentResultSchema.safeParse(result);
  if (!parsed.success) throw new Error(`topics assign result failed schema validation: ${parsed.error.issues.length} issue(s)`);
  const seen = new Set<number>();
  for (const assignment of parsed.data.assignments) {
    const item = items[assignment.itemIndex];
    if (!item || seen.has(assignment.itemIndex)) throw new Error('topics_assignment_invalid_item_index');
    seen.add(assignment.itemIndex);
    const keys = new Set<string>();
    for (const topic of assignment.topics) {
      if (!taxonomyKeys.has(topic.key) || keys.has(topic.key)) throw new Error('topics_assignment_invalid_key');
      keys.add(topic.key);
      if (!item.text.includes(topic.evidence)) throw new Error('topics_assignment_invalid_evidence');
    }
  }
  if (seen.size !== items.length) throw new Error('topics_assignment_incomplete: retry the complete paid chunk');
  return parsed.data.assignments;
}
