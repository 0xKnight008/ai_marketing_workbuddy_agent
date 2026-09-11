import { createHash } from 'node:crypto';

import { z } from 'zod';

import { actionPlanSchema, type ActionPlan, type AiRuntimeEvent } from '../contracts/ai-runtime-event';
import { classifyResultSchema, type TagAssignment } from '../contracts/tagging';
import { insightResultSchemas, insightTemplateSchema, reportDeliverySchema, type InsightTemplate } from '../contracts/insights';
import { buildEvidencePack, validateReportCitations, type EvidenceSourceRow } from '../insight-service/evidence-pack';
import { renderReportDigest, sendReportEmail, type ReportEmailConfig } from '../insight-service/delivery';
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
      if (reservation.guardrail.status === 'paused') {
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
        if (reservation.guardrail.status === 'paused') {
          await this.deferJobForCredits(tx, job, 'import.classify_deferred', { batchId });
          return { deferred: true as const };
        }
        return { deferred: false as const, modelBand: reservation.band, rows: pending.rows };
      });

      if (items.deferred) return;

      if (!items.rows.length) {
        await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
          await tx.query(
            "UPDATE import_batch SET status = 'classified', classified_at = now() WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid",
            [batchId],
          );
          await tx.query(
            'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
            [job.workspaceId, 'import.classified', { batchId }],
          );
          await tx.query("UPDATE job SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2", [job.id, job.workspaceId]);
        });
        return;
      }

      const result = await this.options.aiRuntime.classifyItems({
        modelBand: items.modelBand,
        items: items.rows.map((row, index) => ({ index, text: row.text, author: row.author ?? undefined, platform: row.platform })),
      });

      await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        let written = 0;
        let dropped = 0;
        for (const assignment of parsedAssignments(result)) {
          const item = items.rows[assignment.itemIndex];
          if (!item) { dropped += 1; continue; }
          for (const tag of assignment.tags) {
            // 证据引用硬校验：LLM 必须给出原文逐字摘录，否则该标签作废。
            if (!item.text.includes(tag.evidence)) { dropped += 1; continue; }
            const inserted = await tx.query(
              `INSERT INTO item_tag (workspace_id, item_id, tag, confidence, evidence, model_band)
               VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, $5)
               ON CONFLICT (item_id, tag) DO NOTHING`,
              [item.id, tag.tag, tag.confidence, tag.evidence, items.modelBand],
            );
            written += inserted.rowCount;
          }
        }
        // 无论是否有标签都标记已处理；无标签是合法结果（无信号评论）。
        await tx.query(
          `UPDATE import_item SET classified_at = now()
            WHERE batch_id = $1 AND id = ANY($2::uuid[])`,
          [batchId, items.rows.map((row) => row.id)],
        );
        if (dropped > 0) {
          await tx.query(
            'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
            [job.workspaceId, 'import.classify_evidence_dropped', { batchId, dropped, written }],
          );
        }
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
      if (reservation.guardrail.status === 'paused') {
        await this.deferJobForCredits(tx, job, 'insight.generate_deferred', { reportId });
        return { deferred: true as const };
      }
      const items = await tx.query<EvidenceSourceRow>(
        `SELECT i.id, i.platform, i.author, i.text, i.metrics,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('tag', t.tag, 'evidence', t.evidence, 'confidence', t.confidence::float8))
                            FROM item_tag t WHERE t.item_id = i.id), '[]'::jsonb) AS tags
           FROM import_item i
          WHERE i.batch_id = ANY($1::uuid[]) AND i.workspace_id = current_setting('app.workspace_id')::uuid
          ORDER BY i.created_at, i.id
          LIMIT 2000`,
        [reportRow.batchIds],
      );
      // 每日运营任务是洞察聚合调度器：附带近期已生成报告的摘要作为决策输入。
      let priorReports: Array<{ template: string; title: string; summary: string }> | undefined;
      if (template === 'daily_ops') {
        const prior = await tx.query<{ template: string; title: string; summary: string | null }>(
          `SELECT template, title, report->>'summary' AS summary
             FROM insight_report
            WHERE workspace_id = current_setting('app.workspace_id')::uuid
              AND status = 'generated' AND id <> $1
            ORDER BY created_at DESC LIMIT 4`,
          [reportId],
        );
        priorReports = prior.rows.filter((row) => row.summary).map((row) => ({ template: row.template, title: row.title, summary: row.summary! }));
      }
      return { deferred: false as const, template, modelBand: reservation.band, pack: buildEvidencePack(items.rows), priorReports, fullTextById: new Map(items.rows.map((row) => [row.id, row.text])) };
    });
    if (prepared.deferred) return;

    // 引用校验对照原文全文（证据包内文本被截断到 600 字符，snippet 可能落在截断点之后）。
    const textByRef = new Map<string, string>();
    for (const [ref, itemId] of Object.entries(prepared.pack.refMap)) {
      const fullText = prepared.fullTextById.get(itemId);
      if (fullText !== undefined) textByRef.set(ref, fullText);
    }

    // 2. LLM 生成；schema 非法 → 抛错走 job 重试（与 import.classify 同一语义）。
    const result = await this.options.aiRuntime.generateInsightReport({
      template: prepared.template,
      modelBand: prepared.modelBand,
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
    const cleaned = schema.parse(validateReportCitations(parsed.data, textByRef, stats));

    await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
      await tx.query(
        `UPDATE insight_report
            SET status = 'generated', report = $3::jsonb, dropped_citations = $4, generated_at = now()
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND status = 'generating'`,
        [reportId, job.workspaceId, JSON.stringify({ ...cleaned, _evidence: prepared.pack.refMap }), stats.dropped],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
        [job.workspaceId, 'insight.generated', { reportId, template: prepared.template, droppedCitations: stats.dropped }],
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
    const digest = renderReportDigest({ template: prepared.template, title: prepared.title, itemCount: prepared.itemCount, droppedCitations: prepared.droppedCitations, report: prepared.report });
    if (prepared.delivery.channel === 'email') {
      if (!this.options.email) throw new Error('Email delivery is not configured');
      await sendReportEmail(this.options.email, {
        to: prepared.delivery.target,
        subject: `[Piggybot] ${prepared.title}`.slice(0, 200),
        text: digest,
        idempotencyKey: `insight-delivery/${job.id}`,
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
        content: digest.slice(0, 1_900),
        hashtags: [] as string[],
        mode: 'publish_now' as const,
        idempotencyKey: `insight-delivery:${job.id}`,
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
          WHERE id = $1 AND workspace_id = current_setting('app.workspace_id')::uuid AND delivery->>'status' = 'approved'`,
        [reportId, job.workspaceId, JSON.stringify({ status: 'delivered', deliveredAt: new Date().toISOString() })],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)',
        [job.workspaceId, 'insight.delivered', { reportId, channel: prepared.delivery.channel, targetLabel: prepared.delivery.targetLabel }],
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
      // 报告外发死信：delivery 状态机置为 failed 供前端展示，可重新发起外发。
      if (result.rows[0]?.status === 'dead_lettered' && job.kind === 'insight.deliver' && typeof job.payload.reportId === 'string') {
        await tx.query("UPDATE insight_report SET delivery = COALESCE(delivery, '{}'::jsonb) || $3::jsonb WHERE id = $1 AND workspace_id = $2", [job.payload.reportId, job.workspaceId, JSON.stringify({ status: 'failed', error: message.slice(0, 500) })]);
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
function parsedAssignments(result: Record<string, unknown>): TagAssignment[] {
  const parsed = classifyResultSchema.safeParse(result);
  if (!parsed.success) throw new Error(`classify result failed schema validation: ${parsed.error.issues.length} issue(s)`);
  return parsed.data.assignments;
}
