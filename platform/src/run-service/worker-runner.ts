import { actionPlanSchema, type ActionPlan, type AiRuntimeEvent } from '../contracts/ai-runtime-event';
import type { BrandContextSnapshot } from '../contracts/domain';
import { MODEL_BAND_POLICIES } from '../billing/plans';
import { projectedActionUsage, recordSuccessfulAction, reserveAiRun, type AiReservation, type UsageSnapshot } from '../billing/guardrails';
import { assertExecutableAction, type ConnectedAccountView } from '../connector-service/actions';
import type { TenantTransaction } from '../foundation/database';
import { decryptSecret } from '../foundation/secrets';
import { ingestAiRuntimeEvent } from './repository';

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
}

export interface RunWorkerZernio {
  executeAction(accessToken: string, idempotencyKey: string, action: ActionPlan['actions'][number]): Promise<unknown>;
}

export interface RunWorkerOptions {
  workerName: string;
  database: RunWorkerDatabase;
  aiRuntime: RunWorkerAiRuntime;
  zernio?: RunWorkerZernio;
  secretEncryptionKeyBase64?: string;
  stripeSecretKey?: string;
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
      else throw new Error(`Unsupported job: ${job.kind}`);
    } catch (error) {
      await this.failJob(job, error);
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
      const result = await tx.query<{ id: string; input: Record<string, unknown>; context: BrandContextSnapshot; requestedBy: string }>(
        'SELECT id, input, context_snapshot AS context, requested_by AS "requestedBy" FROM workflow_run WHERE id = $1 AND workspace_id = $2',
        [job.runId, job.workspaceId],
      );
      const found = result.rows[0];
      if (!found) throw new Error('Run not found');
      const reservation = await reserveAiRun(tx, found.context.allowedModelClasses, found.id);
      if (reservation.guardrail.status === 'paused') {
        await this.pauseForBilling(tx, job, reservation.guardrail, 'ai_run');
        return undefined;
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
        const guardrail = await projectedActionUsage(tx, action.platform === 'x');
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

        const account = await tx.query<{ id: string; workspaceId: string; status: ConnectedAccountView['status']; capabilities: string[]; ciphertext: string | null; iv: string | null; authTag: string | null }>(
          `SELECT a.id, a.workspace_id AS "workspaceId", a.status, a.capabilities,
                  s.ciphertext, s.iv, s.auth_tag AS "authTag"
             FROM connected_account a
             LEFT JOIN secret s ON s.id = a.secret_id
            WHERE a.workspace_id = $1 AND a.provider = 'zernio' AND a.external_account_id = $2`,
          [job.workspaceId, action.accountId],
        );
        const connected = account.rows[0];
        if (!connected || !connected.ciphertext || !connected.iv || !connected.authTag) throw new Error('Connected Zernio account has no usable credential');
        return { stepRunId: stepRun.id, connected, action };
      });
      if (!operation) continue;
      if ('halted' in operation) return;
      const { zernio, secretEncryptionKeyBase64 } = this.options;
      if (!zernio || !secretEncryptionKeyBase64) throw new Error('Zernio action execution is not configured');
      const { ciphertext, iv, authTag } = operation.connected;
      if (!ciphertext || !iv || !authTag) throw new Error('Connected Zernio account has no usable credential');
      const account: ConnectedAccountView = {
        id: operation.connected.id,
        workspaceId: operation.connected.workspaceId,
        status: operation.connected.status,
        capabilities: operation.connected.capabilities,
      };
      assertExecutableAction({ workspaceId: job.workspaceId, runId: job.runId, stepId: operation.stepRunId, attempt: 1, account, type: operation.action.type, payload: operation.action });
      const decrypted = decryptSecret({ ciphertext, iv, authTag }, secretEncryptionKeyBase64);
      const credential = parseZernioCredential(decrypted);
      const result = await zernio.executeAction(credential.accessToken, operation.action.idempotencyKey, operation.action);
      await this.options.database.withWorkspace(job.workspaceId, async (tx) => {
        await tx.query("UPDATE step_run SET status = 'succeeded', output = $2, finished_at = now() WHERE id = $1 AND workspace_id = $3", [operation.stepRunId, result, job.workspaceId]);
        await recordSuccessfulAction(tx, { runId: job.runId!, stepRunId: operation.stepRunId, actionType: operation.action.type, isX: operation.action.platform === 'x' });
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
    });
  }
}

export function parseZernioCredential(value: string): { accessToken: string } {
  try {
    const parsed = JSON.parse(value) as { accessToken?: unknown };
    if (typeof parsed.accessToken === 'string' && parsed.accessToken) return { accessToken: parsed.accessToken };
  } catch {
    // Accept the legacy single-token secret format during migration.
  }
  if (value) return { accessToken: value };
  throw new Error('Connected Zernio account credential is invalid');
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
      maxInputTokens: policy.maxInputTokens,
      maxOutputTokens: policy.maxOutputTokens,
      maxTargets: policy.maxTargets,
    },
  };
}
