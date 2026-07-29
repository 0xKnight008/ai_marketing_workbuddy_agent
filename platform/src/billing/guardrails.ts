import type { TenantTransaction } from '../foundation/database';
import { MODEL_BAND_POLICIES, PLAN_CATALOG, planKey, requestedModelBand, type ModelBand, type PlanKey } from './plans';

const WARNING_RATIO = 0.8;
const MICROS_PER_CENT = 10_000;

export type GuardrailStatus = 'normal' | 'approval_required' | 'paused';

export interface UsageSnapshot {
  plan: PlanKey;
  taskUsed: number;
  taskQuota: number;
  aiCreditsUsed: number;
  aiCreditsAvailable: number;
  supplierSpendMicros: number;
  supplierSpendLimitMicros: number;
  status: GuardrailStatus;
  subscriptionStatus: string;
  trialEndsAt?: string;
}

interface BillingRow { plan: string; purchasedCredits: string | number; subscriptionStatus: string; trialEndsAt: string | null; }
interface UsageRow { taskUsed: string | number; aiCreditsUsed: string | number; supplierSpendMicros: string | number; }
interface AccountRow { connectedAccounts: string | number; }

function number(value: string | number | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function monthlyZernioMicros(accountCount: number): number {
  const paidAccounts = Math.max(0, accountCount - 2);
  const tierOne = Math.min(paidAccounts, 8) * 600_000;
  const tierTwo = Math.min(Math.max(0, paidAccounts - 8), 90) * 300_000;
  const tierThree = Math.max(0, paidAccounts - 98) * 100_000;
  return tierOne + tierTwo + tierThree;
}

export function guardrailStatus(taskUsed: number, taskQuota: number, supplierSpendMicros: number, supplierSpendLimitMicros: number): GuardrailStatus {
  if (taskUsed >= taskQuota || supplierSpendMicros >= supplierSpendLimitMicros) return 'paused';
  if (taskUsed >= taskQuota * WARNING_RATIO || supplierSpendMicros >= supplierSpendLimitMicros * WARNING_RATIO) return 'approval_required';
  return 'normal';
}

async function billingRow(tx: TenantTransaction): Promise<BillingRow> {
  const row = await tx.query<BillingRow>(`
    INSERT INTO workspace_billing (workspace_id, period_start, plan, purchased_ai_credits)
    VALUES (current_setting('app.workspace_id')::uuid, date_trunc('month', now())::date, 'creator', 0)
    ON CONFLICT (workspace_id) DO UPDATE
      SET period_start = EXCLUDED.period_start,
          purchased_ai_credits = CASE WHEN workspace_billing.period_start < EXCLUDED.period_start THEN 0 ELSE workspace_billing.purchased_ai_credits END,
          updated_at = now()
    RETURNING plan, purchased_ai_credits AS "purchasedCredits", subscription_status AS "subscriptionStatus", trial_ends_at::text AS "trialEndsAt"`, []);
  const value = row.rows[0];
  if (!value) throw new Error('Workspace billing record was not available');
  return value;
}

export async function usageSnapshot(tx: TenantTransaction): Promise<UsageSnapshot> {
  const billing = await billingRow(tx);
  const plan = planKey(billing.plan);
  const entitlement = PLAN_CATALOG[plan];
  const trialActive = billing.trialEndsAt !== null && new Date(billing.trialEndsAt).getTime() > Date.now();
  const periodUsage = await tx.query<UsageRow>(`
    SELECT COALESCE(SUM(CASE WHEN status = 'reversed' THEN -billable_units ELSE billable_units END), 0) AS "taskUsed",
           COALESCE(SUM(CASE WHEN status = 'reversed' THEN -ai_credits ELSE ai_credits END), 0) AS "aiCreditsUsed",
           COALESCE(SUM(CASE WHEN status = 'reversed' THEN -supplier_cost_micros ELSE supplier_cost_micros END), 0) AS "supplierSpendMicros"
      FROM task_event
     WHERE workspace_id = current_setting('app.workspace_id')::uuid
       AND created_at >= date_trunc('month', now())`, []);
  const accounts = await tx.query<AccountRow>(`SELECT COUNT(*) AS "connectedAccounts" FROM connected_account WHERE workspace_id = current_setting('app.workspace_id')::uuid AND status = 'connected'`, []);
  const usage = periodUsage.rows[0] ?? { taskUsed: 0, aiCreditsUsed: 0, supplierSpendMicros: 0 };
  const taskUsed = number(usage.taskUsed);
  const aiCreditsUsed = number(usage.aiCreditsUsed);
  const supplierSpendMicros = number(usage.supplierSpendMicros) + monthlyZernioMicros(number(accounts.rows[0]?.connectedAccounts));
  const supplierSpendLimitMicros = entitlement.supplierSpendLimitCents * MICROS_PER_CENT;
  return {
    plan,
    taskUsed,
    taskQuota: entitlement.taskQuota,
    aiCreditsUsed,
    aiCreditsAvailable: Math.max(0, (trialActive ? 30 : entitlement.aiCredits) + number(billing.purchasedCredits) - aiCreditsUsed),
    supplierSpendMicros,
    supplierSpendLimitMicros,
    status: billing.subscriptionStatus === 'inactive'
      ? 'paused'
      : guardrailStatus(taskUsed, entitlement.taskQuota, supplierSpendMicros, supplierSpendLimitMicros),
    subscriptionStatus: billing.subscriptionStatus,
    trialEndsAt: trialActive ? billing.trialEndsAt ?? undefined : undefined,
  };
}

export interface AiReservation {
  band: ModelBand;
  credits: number;
  supplierCostMicros: number;
  guardrail: UsageSnapshot;
}

export async function reserveAiRun(tx: TenantTransaction, allowedModelClasses: string[], runId: string): Promise<AiReservation> {
  const current = await usageSnapshot(tx);
  const requested = requestedModelBand(allowedModelClasses);
  const requestedPolicy = MODEL_BAND_POLICIES[requested];
  const useFallbackEco = requested !== 'eco' && current.aiCreditsAvailable < requestedPolicy.credits;
  const band = useFallbackEco ? 'eco' : requested;
  const policy = MODEL_BAND_POLICIES[band];
  const credits = current.aiCreditsAvailable >= policy.credits ? policy.credits : 0;
  const projectedSpend = current.supplierSpendMicros + policy.supplierCostMicros;
  const projected = { ...current, supplierSpendMicros: projectedSpend, status: guardrailStatus(current.taskUsed, current.taskQuota, projectedSpend, current.supplierSpendLimitMicros) };
  if (projected.status === 'paused') return { band, credits, supplierCostMicros: policy.supplierCostMicros, guardrail: projected };
  await tx.query(`INSERT INTO task_event (workspace_id, run_id, action_type, billable_units, ai_credits, supplier_cost_micros, status)
    VALUES (current_setting('app.workspace_id')::uuid, $1, $2, 0, $3, $4, 'succeeded') ON CONFLICT DO NOTHING`, [runId, `ai.${band}`, credits, policy.supplierCostMicros]);
  return { band, credits, supplierCostMicros: policy.supplierCostMicros, guardrail: projected };
}

export async function recordSuccessfulAction(tx: TenantTransaction, input: { runId: string; stepRunId: string; actionType: string; isX: boolean }): Promise<UsageSnapshot> {
  const taskUnits = input.isX ? 3 : 1;
  const supplierCostMicros = input.isX ? 10_000 : 0;
  const current = await usageSnapshot(tx);
  const projected = { ...current, taskUsed: current.taskUsed + taskUnits, supplierSpendMicros: current.supplierSpendMicros + supplierCostMicros };
  projected.status = guardrailStatus(projected.taskUsed, projected.taskQuota, projected.supplierSpendMicros, projected.supplierSpendLimitMicros);
  await tx.query(`INSERT INTO task_event (workspace_id, run_id, step_run_id, action_type, billable_units, ai_credits, supplier_cost_micros, status)
    VALUES (current_setting('app.workspace_id')::uuid, $1, $2, $3, $4, 0, $5, 'succeeded') ON CONFLICT DO NOTHING`, [input.runId, input.stepRunId, input.actionType, taskUnits, supplierCostMicros]);
  return projected;
}

export async function projectedActionUsage(tx: TenantTransaction, isX: boolean): Promise<UsageSnapshot> {
  const current = await usageSnapshot(tx);
  const taskUnits = isX ? 3 : 1;
  const supplierCostMicros = isX ? 10_000 : 0;
  const projected = {
    ...current,
    taskUsed: current.taskUsed + taskUnits,
    supplierSpendMicros: current.supplierSpendMicros + supplierCostMicros,
  };
  projected.status = guardrailStatus(projected.taskUsed, projected.taskQuota, projected.supplierSpendMicros, projected.supplierSpendLimitMicros);
  return projected;
}

export async function updateEntitlement(tx: TenantTransaction, plan: PlanKey, addedCredits: number): Promise<UsageSnapshot> {
  if (!Number.isInteger(addedCredits) || addedCredits < 0) throw new Error('addedCredits must be a non-negative integer');
  await billingRow(tx);
  await tx.query(`UPDATE workspace_billing SET plan = $1,
      purchased_ai_credits = purchased_ai_credits + $2,
      subscription_status = CASE WHEN subscription_status = 'inactive' THEN 'manual' ELSE subscription_status END,
      updated_at = now()
    WHERE workspace_id = current_setting('app.workspace_id')::uuid`, [plan, addedCredits]);
  return usageSnapshot(tx);
}

export interface StripeActivation {
  eventId: string;
  eventType: string;
  plan: PlanKey;
  customerId?: string;
  subscriptionId?: string;
  priceId?: string;
  subscriptionStatus: string;
  trialEndsAt?: string;
}

/** Applies a verified Stripe event once. Never call this with browser-provided payment data. */
export async function activateStripeSubscription(tx: TenantTransaction, activation: StripeActivation): Promise<{ applied: boolean; usage?: UsageSnapshot }> {
  const recorded = await tx.query<{ externalEventId: string }>(`
    INSERT INTO billing_webhook_event (provider, external_event_id, workspace_id, event_type)
    VALUES ('stripe', $1, current_setting('app.workspace_id')::uuid, $2)
    ON CONFLICT (provider, external_event_id) DO NOTHING
    RETURNING external_event_id AS "externalEventId"`, [activation.eventId, activation.eventType]);
  if (!recorded.rows[0]) return { applied: false };
  await billingRow(tx);
  await tx.query(`UPDATE workspace_billing
    SET plan = $1,
        stripe_customer_id = $2,
        stripe_subscription_id = $3,
        stripe_price_id = $4,
        subscription_status = $5,
        trial_ends_at = $6::timestamptz,
        activated_at = COALESCE(activated_at, now()),
        updated_at = now()
    WHERE workspace_id = current_setting('app.workspace_id')::uuid`, [
    activation.plan,
    activation.customerId ?? null,
    activation.subscriptionId ?? null,
    activation.priceId ?? null,
    activation.subscriptionStatus,
    activation.trialEndsAt ?? null,
  ]);
  return { applied: true, usage: await usageSnapshot(tx) };
}

/** Requeue runs stopped solely by a billing guardrail after an owner changes entitlements. */
export async function resumeBillingPausedRuns(tx: TenantTransaction): Promise<number> {
  const paused = await tx.query<{ runId: string; pausedEventKey: string; jobKind: string; jobPayload: Record<string, unknown> }>(`
    SELECT r.id AS "runId", e.event_key AS "pausedEventKey", e.payload->>'jobKind' AS "jobKind", e.payload->'jobPayload' AS "jobPayload"
      FROM workflow_run r
      JOIN LATERAL (
        SELECT event_key, payload, created_at
          FROM run_event
         WHERE run_id = r.id AND event_type = 'billing.paused'
         ORDER BY created_at DESC
         LIMIT 1
      ) e ON true
     WHERE r.workspace_id = current_setting('app.workspace_id')::uuid
       AND r.status = 'waiting_approval'
       AND NOT EXISTS (
         SELECT 1 FROM run_event resumed
          WHERE resumed.run_id = r.id
            AND resumed.event_type = 'billing.resumed'
            AND resumed.created_at > e.created_at
       )`, []);
  for (const run of paused.rows) {
    if (!run.jobKind || !run.jobPayload) continue;
    await tx.query("UPDATE workflow_run SET status = 'queued' WHERE id = $1 AND status = 'waiting_approval'", [run.runId]);
    await tx.query('INSERT INTO job (workspace_id, run_id, kind, payload) VALUES (current_setting(\'app.workspace_id\')::uuid, $1, $2, $3)', [run.runId, run.jobKind, run.jobPayload]);
    await tx.query('INSERT INTO run_event (workspace_id, run_id, event_key, event_type, payload) VALUES (current_setting(\'app.workspace_id\')::uuid, $1, $2, $3, $4) ON CONFLICT (run_id, event_key) DO NOTHING', [run.runId, `billing:${run.runId}:resumed:${run.pausedEventKey}`, 'billing.resumed', { reason: 'entitlement_updated', pausedEventKey: run.pausedEventKey }]);
  }
  return paused.rows.length;
}
