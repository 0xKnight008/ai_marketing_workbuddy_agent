import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  COST_VERSION,
  costCredits,
  creditCostCeiling,
  meteringMode,
  ratesFromEnv,
  rateForTime,
  usageCostNanos,
  type Band,
  type Rate,
  type MeterEnvelope,
} from "../../../shared/ai-metering";
import type { ActorContext } from "../contracts/domain";
import type { TenantTransaction, Database } from "../foundation/database";
import {
  TrialConversionRequired,
  type AiReservation,
  type AiUsageSubject,
  type UsageSnapshot,
} from "./guardrails";
import { MODEL_BAND_POLICIES } from "./plans";
import { HttpError } from "../http/errors";
import { requirePermission } from "../foundation/rbac";

export class CostBudgetRequired extends HttpError {
  constructor(
    readonly band: Band,
    code: string,
  ) {
    super(409, code);
  }
}
export const costContext = new AsyncLocalStorage<{
  workspaceId: string;
  database: Pick<Database, "withWorkspace">;
  envelope?: MeterEnvelope;
}>();
const quoteSchema = z.object({
  kind: z.enum([
    "task.turn",
    "import.classify",
    "insight.generate",
    "topics.cluster",
    "prepare_ai_run",
  ]),
  modelBand: z.enum(["eco", "standard", "flagship"]),
  maxCredits: z.number().int().min(1).max(1000000).optional(),
});
const uuid = z.string().uuid();
type Operation = {
  id: string;
  mode: "shadow" | "cost-v1";
  band: Band;
  rate: Rate;
  max_credits: number;
  max_calls: number;
  state: string;
  subject_id: string;
  held_credits: number;
  settled_credits: number;
  valid_cost_nanos: string;
  hold_trial: string;
  hold_purchased: string;
  credit_period: string;
};
export async function quoteCost(
  database: Pick<Database, "withWorkspace">,
  actor: ActorContext,
  body: unknown,
) {
  requirePermission(actor.role, "workflow:run");
  const input = quoteSchema.parse(body),
    mode = meteringMode();
  if (mode === "legacy")
    return {
      mode,
      modelBand: input.modelBand,
      estimatedCredits: MODEL_BAND_POLICIES[input.modelBand].credits,
      maxCredits: MODEL_BAND_POLICIES[input.modelBand].credits,
    };
  const rate = ratesFromEnv()[input.modelBand],
    policy = MODEL_BAND_POLICIES[input.modelBand];
  rateForTime(rate, new Date().toISOString());
  return database.withWorkspace(actor.workspaceId, async (tx) => {
    let maxCalls =
      input.kind === "task.turn" ? 4 : input.kind === "prepare_ai_run" ? 3 : 1;
    if (input.kind === "import.classify") maxCalls = 1000; // actual operation budget is always user-capped
    if (input.kind === "topics.cluster") {
      const count = await tx.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM import_item WHERE workspace_id=$1 AND classified_at IS NOT NULL",
        [actor.workspaceId],
      );
      maxCalls = Math.min(
        10001,
        1 + Math.ceil(Number(count.rows[0]?.count ?? 0) / 50),
      );
    }
    const perCall = usageCostNanos(rate, {
      input: policy.maxInputTokens,
      output: policy.maxOutputTokens,
      cached: 0,
    });
    const ceiling = costCredits(perCall * BigInt(maxCalls));
    const current = await (await import("./guardrails")).usageSnapshot(tx);
    const defaultMaximum = Math.max(
      1,
      Math.min(ceiling, input.kind === "import.classify" ? 100 : ceiling),
    );
    const maximum =
      input.maxCredits ??
      (current.aiCreditsAvailable >= 1
        ? Math.min(defaultMaximum, Math.floor(current.aiCreditsAvailable))
        : defaultMaximum);
    const estimate = Math.min(maximum, costCredits(perCall));
    const r = await tx.query<{ id: string; expiresAt: string }>(
      `INSERT INTO ai_cost_operation(workspace_id,actor_id,kind,band,rate,estimated_credits,max_credits,max_calls,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,expires_at::text AS "expiresAt"`,
      [
        actor.workspaceId,
        actor.actorId,
        input.kind,
        input.modelBand,
        JSON.stringify(rate),
        estimate,
        maximum,
        maxCalls,
        mode,
      ],
    );
    return {
      mode,
      quoteId: r.rows[0]!.id,
      modelBand: input.modelBand,
      estimatedCredits: estimate,
      maxCredits: maximum,
      maxCalls,
      subscriptionPaymentRequired:
        current.subscriptionStatus === "trialing" &&
        current.trialConversionAvailable &&
        maximum > current.aiCreditsAvailable,
      expiresAt: r.rows[0]!.expiresAt,
      policyVersion: COST_VERSION,
      rateVersion: rate.version,
    };
  });
}
export async function bindCostQuote(
  tx: TenantTransaction,
  actor: ActorContext,
  body: unknown,
  subjectId: string,
  band: string,
  kind: string,
) {
  if (meteringMode() === "legacy") {
    await tx.query(
      "INSERT INTO ai_cost_legacy_subject(workspace_id,subject_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [actor.workspaceId, subjectId],
    );
    return;
  }
  const quoteId = z.object({ aiQuoteId: uuid }).parse(body).aiQuoteId;
  const existing = await tx.query(
    "SELECT id FROM ai_cost_operation WHERE workspace_id=$1 AND id=$2 AND actor_id=$3 AND subject_id=$4",
    [actor.workspaceId, quoteId, actor.actorId, subjectId],
  );
  if (existing.rowCount) return;
  const result = await tx.query(
    `UPDATE ai_cost_operation SET subject_id=$1,accepted_at=now(),state='accepted' WHERE workspace_id=$2 AND id=$3 AND actor_id=$4 AND kind=$5 AND band=$6 AND state='quoted' AND expires_at>now() RETURNING id`,
    [subjectId, actor.workspaceId, quoteId, actor.actorId, kind, band],
  );
  if (!result.rowCount)
    throw new HttpError(409, "ai_quote_expired_or_mismatched");
}
export async function reserveCost(
  tx: TenantTransaction,
  subject: AiUsageSubject,
  requested: Band,
  usage: UsageSnapshot,
): Promise<AiReservation | undefined> {
  const ctx = costContext.getStore();
  if (!ctx) return; // legacy callbacks/old in-flight jobs retain their policy
  const result = await tx.query<Operation>(
    `SELECT * FROM ai_cost_operation WHERE workspace_id=$1 AND subject_id=$2 AND state<>'quoted' ORDER BY accepted_at DESC LIMIT 1 FOR UPDATE`,
    [ctx.workspaceId, subject.runId ?? subject.subjectId],
  );
  const op = result.rows[0];
  if (!op) {
    if (meteringMode() === "cost-v1") {
      const legacy = await tx.query(
        "SELECT subject_id FROM ai_cost_legacy_subject WHERE workspace_id=$1 AND subject_id=$2",
        [ctx.workspaceId, subject.runId ?? subject.subjectId],
      );
      if (!legacy.rowCount)
        throw new CostBudgetRequired(requested, "ai_quote_required");
    }
    return;
  }
  if (op.band !== requested)
    throw new CostBudgetRequired(requested, "ai_new_model_quote_required");
  if (op.state === "refunded" || op.state === "settled")
    throw new CostBudgetRequired(
      requested,
      "ai_operation_finished_new_quote_required",
    );
  if (op.state === "reconciliation")
    throw new HttpError(409, "ai_usage_reconciliation_pending");
  if (
    op.mode === "cost-v1" &&
    op.state === "accepted" &&
    usage.taskUsed >= usage.taskQuota &&
    requested !== "eco"
  )
    throw new CostBudgetRequired(
      requested,
      "ai_task_quota_requires_eco_consent",
    );
  if (op.mode === "cost-v1") {
    const loss = await tx.query<{ loss: string }>(
      `SELECT COALESCE(sum(GREATEST(0,(SELECT COALESCE(sum(p.cost_nanos),0) FROM ai_cost_receipt p WHERE p.operation_id=o.id AND p.workspace_id=o.workspace_id)+(SELECT COALESCE(sum(r.max_cost_nanos),0) FROM ai_cost_request r WHERE r.operation_id=o.id AND r.workspace_id=o.workspace_id AND EXISTS(SELECT 1 FROM ai_cost_receipt p WHERE p.request_id=r.id AND p.workspace_id=r.workspace_id AND p.status='unknown'))-LEAST(o.valid_cost_nanos,floor(o.settled_credits::numeric*5000000/6)))),0)::text AS loss FROM ai_cost_operation o WHERE o.workspace_id=$1 AND o.mode='cost-v1' AND o.state IN ('settled','refunded') AND o.created_at>=date_trunc('month',now())`,
      [ctx.workspaceId],
    );
    const topups = await tx.query<{ credits: string }>(
      `SELECT GREATEST(0,COALESCE(sum(CASE WHEN kind='reserve' THEN purchased WHEN kind IN ('release','refund') THEN -purchased ELSE 0 END),0))::text AS credits FROM ai_cost_journal WHERE workspace_id=$1 AND credit_period=date_trunc('month',now())::date`,
      [ctx.workspaceId],
    );
    const planBudget =
      usage.subscriptionStatus === "trialing"
        ? 30
        : { creator: 400, growth: 2500, agency: 8000 }[usage.plan];
    const lossLimit = BigInt(
      Math.floor(
        ((planBudget + Number(topups.rows[0]?.credits ?? 0)) * 1000000) / 6,
      ),
    );
    if (BigInt(loss.rows[0]?.loss ?? 0) > lossLimit)
      throw new HttpError(503, "ai_provider_cost_circuit_open");
  }

  const policy = MODEL_BAND_POLICIES[requested];
  if (op.state === "accepted" && op.mode === "cost-v1") {
    if (usage.aiCreditsAvailable < op.max_credits) {
      if (usage.trialConversionAvailable)
        throw new TrialConversionRequired(requested, usage);
      throw new CostBudgetRequired(requested, "ai_budget_insufficient");
    }
    if (usage.status === "paused")
      throw new HttpError(402, "automation_paused");
    const trial =
      usage.subscriptionStatus === "trialing"
        ? op.max_credits
        : Math.min(op.max_credits, usage.trialCreditCarryover ?? 0);
    const included = Math.min(
      op.max_credits - trial,
      Math.max(0, usage.includedCreditsRemaining ?? 0),
    );
    const purchased = op.max_credits - trial - included;
    await tx.query(
      `UPDATE workspace_billing SET purchased_ai_credits=purchased_ai_credits-$1,trial_credit_carryover=trial_credit_carryover-CASE WHEN subscription_status<>'trialing' THEN $2 ELSE 0 END WHERE workspace_id=$3`,
      [purchased, trial, ctx.workspaceId],
    );
    await tx.query(
      `UPDATE ai_cost_operation SET state='reserved',held_credits=max_credits,hold_trial=$1,hold_purchased=$2,credit_period=date_trunc('month',now())::date WHERE id=$3 AND workspace_id=$4`,
      [trial, purchased, op.id, ctx.workspaceId],
    );
    await tx.query(
      `INSERT INTO ai_cost_journal(workspace_id,operation_id,event_key,kind,credits,trial,purchased,credit_period) VALUES($1,$2,'reserve','reserve',$3,$4,$5,date_trunc('month',now())::date) ON CONFLICT DO NOTHING`,
      [ctx.workspaceId, op.id, op.max_credits, trial, purchased],
    );
  }
  const action = subject.actionType ?? "ai",
    attempt = subject.attempt ?? 1;
  let request = await tx.query<{
    id: string;
    max_cost_nanos: string;
    state: string;
  }>(
    `SELECT id,max_cost_nanos::text,state FROM ai_cost_request WHERE workspace_id=$1 AND operation_id=$2 AND action_type=$3 AND attempt=$4 ORDER BY generation DESC LIMIT 1`,
    [ctx.workspaceId, op.id, action, attempt],
  );
  if (request.rows[0]?.state === "unknown")
    throw new HttpError(409, "ai_usage_reconciliation_pending");
  if (!request.rows.length) {
    const count = await tx.query<{ count: string; cost: string }>(
      `SELECT count(*)::text AS count,COALESCE(sum(max_cost_nanos) FILTER(WHERE state<>'valid'),0)::text AS cost FROM ai_cost_request WHERE workspace_id=$1 AND operation_id=$2`,
      [ctx.workspaceId, op.id],
    );
    if (Number(count.rows[0]?.count ?? 0) >= op.max_calls)
      throw new CostBudgetRequired(requested, "ai_confirmed_call_limit");
    const spent = await tx.query<{ cost: string }>(
      `SELECT COALESCE(sum(cost_nanos),0)::text AS cost FROM ai_cost_receipt WHERE workspace_id=$1 AND operation_id=$2`,
      [ctx.workspaceId, op.id],
    );
    const remaining =
      creditCostCeiling(op.max_credits) -
      BigInt(spent.rows[0]?.cost ?? 0) -
      BigInt(count.rows[0]?.cost ?? 0);
    if (remaining <= 0n)
      throw new CostBudgetRequired(requested, "ai_confirmed_budget_exhausted");
    const perCall =
      usageCostNanos(op.rate, {
        input: policy.maxInputTokens,
        output: policy.maxOutputTokens,
        cached: 0,
      }) * (action === "ai" ? 3n : 1n);
    const max = remaining < perCall ? remaining : perCall;
    request = await tx.query(
      `INSERT INTO ai_cost_request(id,workspace_id,operation_id,action_type,attempt,max_cost_nanos) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,max_cost_nanos::text,state`,
      [randomUUID(), ctx.workspaceId, op.id, action, attempt, max.toString()],
    );
  }
  const req = request.rows[0]!;
  ctx.envelope = {
    workspaceId: ctx.workspaceId,
    operationId: op.id,
    requestId: req.id,
    rate: op.rate,
    shadow: op.mode === "shadow",
    band: requested,
    maxCostNanos: req.max_cost_nanos,
    maxInputTokens: policy.maxInputTokens,
    maxOutputTokens: policy.maxOutputTokens,
  };
  if (op.mode === "shadow") return;
  return {
    band: requested,
    provider: "primary",
    credits: op.max_credits,
    supplierCostMicros: 0,
    charged: op.state === "accepted",
    replayed: op.state !== "accepted",
    guardrail: usage,
  };
}
const receiptSchema = z.object({
  id: uuid,
  workspaceId: uuid,
  operationId: uuid,
  requestId: uuid,
  model: z.string().min(1).max(150),
  input: z.number().int().nonnegative().nullable(),
  output: z.number().int().nonnegative().nullable(),
  cached: z.number().int().nonnegative().nullable(),
  costNanos: z.string().nullable(),
  status: z.enum(["known", "unknown"]),
  startedAt: z.string().datetime().optional(),
});
export async function receiveCostReceipts(
  tx: TenantTransaction,
  workspaceId: string,
  raw: unknown,
) {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    const r = receiptSchema.parse(item);
    if (r.workspaceId !== workspaceId)
      throw new Error("metering_workspace_mismatch");
    const found = await tx.query<{ rate: Rate }>(
      `SELECT o.rate FROM ai_cost_request r JOIN ai_cost_operation o ON o.id=r.operation_id AND o.workspace_id=r.workspace_id WHERE r.id=$1 AND r.operation_id=$2 AND r.workspace_id=$3`,
      [r.requestId, r.operationId, workspaceId],
    );
    const rate = found.rows[0]?.rate;
    if (!rate) throw new Error("metering_request_mismatch");
    let cost: string | null = null;
    if (
      r.status === "known" &&
      r.input !== null &&
      r.output !== null &&
      r.cached !== null &&
      rate.responseModels.includes(r.model) &&
      (!rate.periods || r.startedAt)
    ) {
      try {
        cost = usageCostNanos(
          rate,
          { input: r.input, output: r.output, cached: r.cached },
          r.startedAt,
        ).toString();
      } catch {
        /* Keep an unverifiable tariff pending; never guess a charge. */
      }
    }
    const inserted = await tx.query(
      `INSERT INTO ai_cost_receipt(workspace_id,id,operation_id,request_id,model,prompt_tokens,completion_tokens,cached_tokens,cost_nanos,status,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id`,
      [
        workspaceId,
        r.id,
        r.operationId,
        r.requestId,
        r.model,
        r.input,
        r.output,
        r.cached,
        cost,
        cost === null ? "unknown" : "known",
        r.startedAt ?? null,
      ],
    );
    if (!inserted.rowCount) {
      const same = await tx.query(
        `SELECT id FROM ai_cost_receipt WHERE workspace_id=$1 AND id=$2 AND operation_id=$3 AND request_id=$4 AND model=$5 AND cost_nanos IS NOT DISTINCT FROM $6::bigint AND prompt_tokens IS NOT DISTINCT FROM $7::integer AND completion_tokens IS NOT DISTINCT FROM $8::integer`,
        [
          workspaceId,
          r.id,
          r.operationId,
          r.requestId,
          r.model,
          cost,
          r.input,
          r.output,
        ],
      );
      if (!same.rowCount) throw new Error("metering_receipt_conflict");
    }
    await tx.query(
      `UPDATE ai_cost_request SET state=CASE WHEN $1::bigint IS NULL THEN 'unknown' ELSE CASE WHEN state='valid' THEN 'valid' ELSE 'received' END END WHERE id=$2 AND workspace_id=$3`,
      [cost, r.requestId, workspaceId],
    );
  }
}
/** Budget reconfirmation continues one business subject: do not round each
 * approved budget segment into another minimum credit. Prior journals stay immutable. */
async function cumulativeCharge(
  tx: TenantTransaction,
  op: Operation,
  cost: bigint,
) {
  if (op.mode === "shadow") return Math.min(op.max_credits, costCredits(cost));
  const previous = await tx.query<{ cost: string; credits: string }>(
    `SELECT COALESCE(sum(valid_cost_nanos),0)::text AS cost,COALESCE(sum(settled_credits),0)::text AS credits FROM ai_cost_operation WHERE workspace_id=current_setting('app.workspace_id')::uuid AND subject_id=$1 AND id<>$2 AND mode='cost-v1' AND state IN ('settled','refunded')`,
    [op.subject_id, op.id],
  );
  return Math.min(
    op.max_credits,
    Math.max(
      0,
      costCredits(cost + BigInt(previous.rows[0]?.cost ?? 0)) -
        Number(previous.rows[0]?.credits ?? 0),
    ),
  );
}
export async function settleCost(
  tx: TenantTransaction,
  subject: AiUsageSubject,
) {
  await tx.query(
    `SELECT workspace_id FROM workspace_billing WHERE workspace_id=current_setting('app.workspace_id')::uuid FOR UPDATE`,
  );
  const requests = await tx.query<{
    id: string;
    operation_id: string;
    unknown: boolean;
  }>(
    `SELECT r.id,r.operation_id,(NOT EXISTS(SELECT 1 FROM ai_cost_receipt p WHERE p.request_id=r.id AND p.workspace_id=r.workspace_id) OR EXISTS(SELECT 1 FROM ai_cost_receipt p WHERE p.request_id=r.id AND p.workspace_id=r.workspace_id AND p.status='unknown')) AS unknown FROM ai_cost_request r JOIN ai_cost_operation o ON o.id=r.operation_id AND o.workspace_id=r.workspace_id WHERE o.workspace_id=current_setting('app.workspace_id')::uuid AND o.subject_id=$1 AND o.state IN ('accepted','reserved','reconciliation') AND ($2::text IS NULL OR r.action_type=$2) AND ($3::integer IS NULL OR r.attempt=$3)`,
    [
      subject.runId ?? subject.subjectId,
      subject.actionType ?? null,
      subject.attempt ?? null,
    ],
  );
  for (const r of requests.rows) {
    await tx.query(
      `UPDATE ai_cost_request SET state=$1,valid_at=now() WHERE id=$2 AND workspace_id=current_setting('app.workspace_id')::uuid`,
      [r.unknown ? "unknown" : "valid", r.id],
    );
    if (r.unknown)
      await tx.query(
        `UPDATE ai_cost_operation SET state='reconciliation' WHERE id=$1 AND workspace_id=current_setting('app.workspace_id')::uuid AND state='reserved'`,
        [r.operation_id],
      );
    const rows = await tx.query<Operation>(
      `SELECT * FROM ai_cost_operation WHERE id=$1 AND workspace_id=current_setting('app.workspace_id')::uuid FOR UPDATE`,
      [r.operation_id],
    );
    const op = rows.rows[0];
    if (op) {
      const amount = await tx.query<{ cost: string }>(
        `SELECT COALESCE(sum(p.cost_nanos),0)::text AS cost FROM ai_cost_receipt p JOIN ai_cost_request q ON q.id=p.request_id AND q.workspace_id=p.workspace_id WHERE p.workspace_id=current_setting('app.workspace_id')::uuid AND p.operation_id=$1 AND q.valid_at IS NOT NULL AND p.status='known'`,
        [op.id],
      );
      const cost = BigInt(amount.rows[0]?.cost ?? 0),
        actual = await cumulativeCharge(tx, op, cost);
      if (op.mode === "cost-v1")
        await tx.query(
          `INSERT INTO ai_cost_journal(workspace_id,operation_id,event_key,kind,credits,credit_period) VALUES(current_setting('app.workspace_id')::uuid,$1,$2,'settle',$3,$4) ON CONFLICT DO NOTHING`,
          [
            op.id,
            "valid:" + r.id,
            Math.max(0, actual - op.settled_credits),
            op.credit_period,
          ],
        );
      await tx.query(
        `UPDATE ai_cost_operation SET valid_cost_nanos=$1,settled_credits=$2 WHERE workspace_id=current_setting('app.workspace_id')::uuid AND id=$3`,
        [cost.toString(), actual, op.id],
      );
    }
  }
}
export async function finishCost(
  tx: TenantTransaction,
  subjectId: string,
  failed = false,
  expired = false,
) {
  await tx.query(
    `SELECT workspace_id FROM workspace_billing WHERE workspace_id=current_setting('app.workspace_id')::uuid FOR UPDATE`,
  );
  const rows = await tx.query<Operation>(
    `SELECT * FROM ai_cost_operation WHERE workspace_id=current_setting('app.workspace_id')::uuid AND subject_id=$1 AND state IN ('accepted','reserved','reconciliation') FOR UPDATE`,
    [subjectId],
  );
  for (const op of rows.rows) {
    if (op.state === "accepted" && op.mode === "cost-v1") {
      await tx.query(
        `UPDATE ai_cost_operation SET state='refunded' WHERE id=$1 AND workspace_id=current_setting('app.workspace_id')::uuid`,
        [op.id],
      );
      continue;
    }
    if (op.state === "reconciliation" && !expired) continue;
    const result = await tx.query<{ cost: string }>(
      `SELECT COALESCE(sum(p.cost_nanos),0)::text AS cost FROM ai_cost_receipt p JOIN ai_cost_request r ON r.id=p.request_id AND r.workspace_id=p.workspace_id WHERE p.workspace_id=current_setting('app.workspace_id')::uuid AND p.operation_id=$1 AND r.valid_at IS NOT NULL AND p.status='known'`,
      [op.id],
    );
    const cost = BigInt(result.rows[0]?.cost ?? 0),
      actual = await cumulativeCharge(tx, op, cost);
    if (op.mode === "shadow") {
      await tx.query(
        `UPDATE ai_cost_operation SET state='settled',valid_cost_nanos=$1,settled_credits=$2 WHERE id=$3 AND workspace_id=current_setting('app.workspace_id')::uuid`,
        [cost.toString(), actual, op.id],
      );
      continue;
    }
    const trial = Number(op.hold_trial),
      purchased = Number(op.hold_purchased),
      included = op.max_credits - trial - purchased;
    const usedTrial = Math.min(actual, trial),
      usedIncluded = Math.min(Math.max(0, actual - usedTrial), included),
      usedPurchased = Math.max(0, actual - usedTrial - usedIncluded);
    const release = op.max_credits - actual,
      returnTrial = trial - usedTrial,
      returnPurchased = purchased - usedPurchased;
    const once = await tx.query(
      `INSERT INTO ai_cost_journal(workspace_id,operation_id,event_key,kind,credits,trial,purchased,credit_period) VALUES(current_setting('app.workspace_id')::uuid,$1,'final-release',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
      [
        op.id,
        failed ? "refund" : "release",
        release,
        returnTrial,
        returnPurchased,
        op.credit_period,
      ],
    );
    if (!once.rowCount) continue;
    await tx.query(
      `UPDATE workspace_billing SET purchased_ai_credits=purchased_ai_credits+GREATEST(0,$1::numeric-credit_refund_debt),credit_refund_debt=GREATEST(0,credit_refund_debt-$1::numeric),trial_credit_carryover=LEAST(30,trial_credit_carryover+CASE WHEN subscription_status<>'trialing' AND (SELECT created_at FROM ai_cost_operation WHERE id=$3 AND workspace_id=current_setting('app.workspace_id')::uuid)>=trial_started_at THEN $2::numeric ELSE 0 END),updated_at=now() WHERE workspace_id=current_setting('app.workspace_id')::uuid`,
      [returnPurchased, returnTrial, op.id],
    );
    await tx.query(
      `UPDATE ai_cost_operation SET settled_credits=$1,valid_cost_nanos=$2,held_credits=0,state=$3 WHERE id=$4 AND workspace_id=current_setting('app.workspace_id')::uuid`,
      [
        actual,
        cost.toString(),
        failed && actual === 0 ? "refunded" : "settled",
        op.id,
      ],
    );
    await tx.query(
      `INSERT INTO ai_cost_journal(workspace_id,operation_id,event_key,kind,credits,credit_period) VALUES(current_setting('app.workspace_id')::uuid,$1,'settled','settle',$2,$3) ON CONFLICT DO NOTHING`,
      [op.id, Math.max(0, actual - op.settled_credits), op.credit_period],
    );
  }
}
export async function expireCost(tx: TenantTransaction) {
  const terminal = await tx.query<{ subject_id: string }>(
    `SELECT o.subject_id FROM ai_cost_operation o WHERE o.workspace_id=current_setting('app.workspace_id')::uuid AND o.state='reserved' AND EXISTS(SELECT 1 FROM job j WHERE j.workspace_id=o.workspace_id AND j.status='dead_lettered' AND (j.run_id=o.subject_id OR j.payload->>'messageId'=o.subject_id::text OR j.payload->>'batchId'=o.subject_id::text OR j.payload->>'reportId'=o.subject_id::text OR j.payload->>'runId'=o.subject_id::text)) AND NOT EXISTS(SELECT 1 FROM job j WHERE j.workspace_id=o.workspace_id AND j.status IN ('queued','running') AND (j.run_id=o.subject_id OR j.payload->>'messageId'=o.subject_id::text OR j.payload->>'batchId'=o.subject_id::text OR j.payload->>'reportId'=o.subject_id::text OR j.payload->>'runId'=o.subject_id::text)) LIMIT 100`,
  );
  for (const r of terminal.rows) await finishCost(tx, r.subject_id, true);
  const rows = await tx.query<{ subject_id: string }>(
    `SELECT subject_id FROM ai_cost_operation WHERE workspace_id=current_setting('app.workspace_id')::uuid AND state='reconciliation' AND created_at<now()-interval '24 hours' LIMIT 100`,
  );
  for (const r of rows.rows) await finishCost(tx, r.subject_id, true, true);
}
export async function costUsage(tx: TenantTransaction) {
  const r = await tx.query<{
    used: string;
    trial: string;
    held: string;
    spend: string;
  }>(`
 SELECT COALESCE((SELECT sum(CASE WHEN kind='reserve' THEN credits-trial WHEN kind IN ('release','refund') THEN -(credits-trial) ELSE 0 END)
   FROM ai_cost_journal WHERE workspace_id=current_setting('app.workspace_id')::uuid AND credit_period=date_trunc('month',now())::date),0)::text AS used,
 COALESCE((SELECT sum(CASE WHEN j.kind='reserve' THEN j.trial WHEN j.kind IN ('release','refund') THEN -j.trial ELSE 0 END)
   FROM ai_cost_journal j JOIN ai_cost_operation o ON o.id=j.operation_id AND o.workspace_id=j.workspace_id
   WHERE j.workspace_id=current_setting('app.workspace_id')::uuid AND o.created_at >=
    (SELECT COALESCE(trial_started_at,trial_ends_at-interval '7 days','-infinity'::timestamptz) FROM workspace_billing WHERE workspace_id=j.workspace_id)),0)::text AS trial,
 COALESCE((SELECT sum(GREATEST(0,held_credits-settled_credits)) FROM ai_cost_operation
   WHERE workspace_id=current_setting('app.workspace_id')::uuid AND state IN ('reserved','reconciliation')),0)::text AS held,
 COALESCE((SELECT sum(cost_nanos)/1000 FROM ai_cost_receipt p WHERE workspace_id=current_setting('app.workspace_id')::uuid
   AND COALESCE(started_at,created_at)>=date_trunc('month',now()) AND EXISTS
    (SELECT 1 FROM ai_cost_operation o WHERE o.id=p.operation_id AND o.workspace_id=p.workspace_id AND o.mode='cost-v1')),0)::text AS spend`);
  return r.rows[0] ?? { used: "0", trial: "0", held: "0", spend: "0" };
}

export async function costOperations(
  tx: TenantTransaction,
  admin = false,
  subjects?: string[],
) {
  return (
    await tx.query(
      `SELECT o.id,o.subject_id AS "subjectId",o.band,o.mode,o.kind,o.state,o.policy_version AS "policyVersion",o.rate->>'version' AS "rateVersion",o.max_credits AS "maxCredits",GREATEST(0,o.held_credits-o.settled_credits) AS "heldCredits",o.settled_credits AS "settledCredits",COALESCE((SELECT sum(j.credits) FROM ai_cost_journal j WHERE j.workspace_id=o.workspace_id AND j.operation_id=o.id AND j.kind IN ('release','refund')),0)::integer AS "releasedCredits",o.created_at::text AS "createdAt",COALESCE((SELECT jsonb_agg(DISTINCT p.model) FROM ai_cost_receipt p WHERE p.operation_id=o.id AND p.workspace_id=o.workspace_id),'[]') AS "actualModels" ${admin ? ',(SELECT sum(cost_nanos)::text FROM ai_cost_receipt WHERE operation_id=o.id AND workspace_id=o.workspace_id) AS "supplierCostNanos",(SELECT count(*) FROM ai_cost_receipt WHERE operation_id=o.id AND workspace_id=o.workspace_id AND status=\'unknown\') AS "unknownReceipts"' : ""} FROM ai_cost_operation o WHERE workspace_id=current_setting('app.workspace_id')::uuid AND state<>'quoted' AND ($1::uuid[] IS NULL OR subject_id=ANY($1::uuid[])) ${admin ? "" : "AND mode='cost-v1'"} ORDER BY o.created_at DESC,o.id DESC LIMIT 100`,
      [subjects ?? null],
    )
  ).rows;
}
