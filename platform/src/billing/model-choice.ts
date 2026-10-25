import { bindCostQuote, finishCost, costOperations } from './cost-metering';
import { meteringMode } from '../../../shared/ai-metering';
import { convertSubscribedTrial } from "./trial-conversion";
import { z } from "zod";
import type { ActorContext } from "../contracts/domain";
import type { Database } from "../foundation/database";
import { HttpError } from "../http/errors";
import { taskActor, taskAudit } from "../task-service/service";
import { MODEL_BANDS, MODEL_BAND_POLICIES, type ModelBand } from "./plans";
import {
  requireAutomationAccess,
  usageSnapshot,
  type UsageSnapshot,
} from "./guardrails";

export function modelChoices(requested: ModelBand, usage: UsageSnapshot) {
  const max = MODEL_BANDS.indexOf(requested);
  return MODEL_BANDS.filter(
    (band, index) =>
      index <= max &&
      usage.aiCreditsAvailable >= MODEL_BAND_POLICIES[band].credits &&
      (usage.status !== "degraded" || band === "eco") &&
      usage.status !== "paused" &&
      usage.supplierSpendMicros + MODEL_BAND_POLICIES[band].supplierCostMicros <
        usage.supplierSpendLimitMicros,
  );
}
export class ModelChoiceService {
  constructor(
    private readonly database: Database,
    private readonly stripeSecretKey?: string,
  ) {}
  async list(actor: ActorContext) {
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor);
      const rows = await tx.query<{
        id: string;
        kind: string;
        payload: {
          taskId?: string;
          modelChoice: { requestedBand: ModelBand; reason: string };
        };
        label?: string;
      }>(
        `SELECT j.id,j.kind,j.payload,COALESCE((SELECT t.goal FROM workspace_task t WHERE t.workspace_id=j.workspace_id AND t.id::text=j.payload->>'taskId'),(SELECT b.label FROM import_batch b WHERE b.workspace_id=j.workspace_id AND b.id::text=j.payload->>'batchId'),(SELECT r.title FROM insight_report r WHERE r.workspace_id=j.workspace_id AND r.id::text=j.payload->>'reportId'),(SELECT w.name FROM workflow_run r JOIN workflow w ON w.id=r.workflow_id AND w.workspace_id=r.workspace_id WHERE r.workspace_id=j.workspace_id AND r.id=j.run_id),'') AS label FROM job j WHERE j.workspace_id=$1 AND j.status='queued' AND j.last_error='model_choice_required' ORDER BY j.created_at LIMIT 50`,
        [actor.workspaceId],
      );
      if (!rows.rows.length) return [];
      const usage = await usageSnapshot(tx);
      return rows.rows.map((row) => {
        const choice = row.payload.modelChoice;
        const legacyTrial =
          choice.reason === "credits" &&
          usage.trialConversionAvailable &&
          usage.aiCreditsAvailable <
            MODEL_BAND_POLICIES[choice.requestedBand].credits;
        return {
          id: row.id,
          kind: row.kind,
          label: row.label,
          taskId: row.payload.taskId ?? null,
          requestedBand: choice.requestedBand,
          reason: legacyTrial ? "trial_payment" : choice.reason,
          availableCredits: usage.aiCreditsAvailable,
          choices: choice.reason==='budget' ? MODEL_BANDS.filter((_,i)=>i<=MODEL_BANDS.indexOf(choice.requestedBand)) : legacyTrial
            ? [choice.requestedBand]
            : choice.reason === "trial_payment"
              ? usage.subscriptionStatus !== "active"
                ? []
                : modelChoices(choice.requestedBand, usage).includes(
                      choice.requestedBand,
                    )
                  ? [choice.requestedBand]
                  : modelChoices(choice.requestedBand, usage)
              : modelChoices(choice.requestedBand, usage),
        };
      });
    });
  }
  async choose(actor: ActorContext, id: unknown, body: unknown) {
    const jobId = z.string().uuid().parse(id);
    const input = z
      .object({
        modelBand: z.enum(MODEL_BANDS),
        reason: z.string().trim().min(3).max(1000),
        requestId: z.string().uuid().optional(),
      })
      .parse(body);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor, true);
      const result = await tx.query<{
        payload: {
          taskId?: string;
          modelChoice?: {
            requestedBand: ModelBand;
            reason?: string;
            trialEndsAt?: string;
          };
        };
      }>(
        "SELECT payload FROM job WHERE workspace_id=$1 AND id=$2 AND status='queued' AND last_error='model_choice_required' FOR UPDATE",
        [actor.workspaceId, jobId],
      );
      if (!result.rows[0])
        throw new HttpError(409, "model_choice_no_longer_pending");
      const original = z
        .enum(MODEL_BANDS)
        .parse(result.rows[0].payload.modelChoice?.requestedBand);
      if (
        result.rows[0].payload.modelChoice?.reason === "credits" &&
        input.modelBand === original
      ) {
        const prior = await usageSnapshot(tx);
        if (
          prior.trialConversionAvailable &&
          prior.aiCreditsAvailable < MODEL_BAND_POLICIES[original].credits
        ) {
          if (actor.role !== "owner")
            throw new HttpError(403, "owner_required");
          await tx.query(
            "UPDATE job SET payload=payload||$3::jsonb,last_error=NULL,available_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2",
            [
              actor.workspaceId,
              jobId,
              JSON.stringify({
                modelBandOverride: original,
                modelChoice: null,
              }),
            ],
          );
          await taskAudit(tx, actor, "billing.trial_handoff_requested", {
            jobId,
            requestedBand: original,
            reason: input.reason,
          });
          return { id: jobId, modelBand: original };
        }
      }
      if (result.rows[0].payload.modelChoice?.reason === "trial_payment") {
        if (actor.role !== "owner") throw new HttpError(403, "owner_required");
        const originalTrialEnd =
          result.rows[0].payload.modelChoice?.trialEndsAt;
        if (
          !(await convertSubscribedTrial(
            tx,
            actor.workspaceId,
            this.stripeSecretKey,
            Date.parse(originalTrialEnd ?? "") > Date.now(),
            input.requestId ?? jobId,
          ))
        )
          throw new HttpError(409, "trial_payment_required");
      }
      const usage =
        result.rows[0].payload.modelChoice?.reason === "trial_payment"
          ? await usageSnapshot(tx)
          : await requireAutomationAccess(tx,result.rows[0].payload.modelChoice?.reason==="budget");
      if(meteringMode()!=='legacy'&&(body as Record<string,unknown>).aiQuoteId){
        if(MODEL_BANDS.indexOf(input.modelBand)>MODEL_BANDS.indexOf(original))throw new HttpError(409,'model_choice_unavailable');
        const pending=await tx.query<{payload:Record<string,unknown>;run_id:string|null;kind:string}>('SELECT payload,run_id,kind FROM job WHERE workspace_id=$1 AND id=$2',[actor.workspaceId,jobId]);
        const row=pending.rows[0]!;const subject=String(row.payload.messageId??row.payload.batchId??row.payload.reportId??row.payload.runId??row.run_id);
        await finishCost(tx,subject,true);
        await bindCostQuote(tx,actor,body,subject,input.modelBand,row.kind);
        await tx.query("UPDATE job SET payload=payload||$3::jsonb,last_error=NULL,available_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,jobId,JSON.stringify({modelBandOverride:input.modelBand,modelChoice:null})]);
        await taskAudit(tx,actor,'ai.cost_budget_confirmed',{jobId,modelBand:input.modelBand,reason:input.reason});
        return {id:jobId,modelBand:input.modelBand};
      }
      if (
        result.rows[0].payload.modelChoice?.reason === "trial_payment" &&
        !modelChoices(original, usage).includes(input.modelBand)
      ) {
        await tx.query(
          "UPDATE job SET payload=jsonb_set(payload,'{modelChoice,reason}','\"credits\"'::jsonb),updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [actor.workspaceId, jobId],
        );
        return { id: jobId, modelChoiceRequired: true };
      }
      if (
        result.rows[0].payload.modelChoice?.reason === "trial_payment" &&
        usage.subscriptionStatus !== "active"
      )
        throw new HttpError(409, "trial_payment_required");
      if (!modelChoices(original, usage).includes(input.modelBand))
        throw new HttpError(409, "model_choice_unavailable");
      await tx.query(
        "UPDATE job SET payload=payload||$3::jsonb,last_error=NULL,available_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [
          actor.workspaceId,
          jobId,
          JSON.stringify({
            modelBandOverride: input.modelBand,
            modelChoice: null,
          }),
        ],
      );
      await taskAudit(tx, actor, "ai.model_choice_confirmed", {
        jobId,
        taskId: result.rows[0].payload.taskId ?? null,
        requestedBand: original,
        selectedBand: input.modelBand,
        reason: input.reason,
      });
      return { id: jobId, modelBand: input.modelBand };
    });
  }
}

export async function executionHistory(
  database: Database,
  actor: ActorContext,
  kind: unknown,
  id: unknown,
) {
  const type = z.enum(["report", "import", "workflow", "topics"]).parse(kind),
    sourceId = z.string().uuid().parse(id);
  const table = {
    report: "insight_report",
    import: "import_batch",
    workflow: "workflow_run",
    topics: "topic_run",
  }[type];
  return database.withWorkspace(actor.workspaceId, async (tx) => {
    await taskActor(tx, actor);
    const owned = await tx.query(
      `SELECT id FROM ${table} WHERE workspace_id=$1 AND id=$2`,
      [actor.workspaceId, sourceId],
    );
    if (!owned.rows[0])
      throw new HttpError(404, "model_execution_source_not_found");
    const legacy = (
      await tx.query(
        `SELECT attempt AS step,model_band AS band,supplier AS provider,CASE WHEN ai_reservation_state='refunded' THEN 0 ELSE ai_credits END AS credits,ai_reservation_state AS "reservationState" FROM task_event WHERE workspace_id=$1 AND (subject_id=$2 OR run_id=$2) AND status='succeeded' AND action_type LIKE 'ai%' ORDER BY created_at LIMIT 1000`,
        [actor.workspaceId, sourceId],
      )
    ).rows;
    const costs=await costOperations(tx,false,[sourceId]);
    return [...legacy,...costs.map(row=>({step:0,band:row.band,provider:row.band==='flagship'?'configured-proxy':'direct',credits:row.settledCredits,reservationState:row.state,costReceipt:row}))];
  });
}
