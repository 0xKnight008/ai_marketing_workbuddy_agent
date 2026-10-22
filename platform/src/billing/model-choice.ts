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
  constructor(private readonly database: Database) {}
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
        return {
          id: row.id,
          kind: row.kind,
          label: row.label,
          taskId: row.payload.taskId ?? null,
          requestedBand: choice.requestedBand,
          reason: choice.reason,
          availableCredits: usage.aiCreditsAvailable,
          choices: modelChoices(choice.requestedBand, usage),
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
      })
      .parse(body);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor, true);
      const result = await tx.query<{
        payload: {
          taskId?: string;
          modelChoice?: { requestedBand: ModelBand };
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
      const usage = await requireAutomationAccess(tx);
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
    return (
      await tx.query(
        `SELECT attempt AS step,model_band AS band,supplier AS provider,ai_credits AS credits FROM task_event WHERE workspace_id=$1 AND (subject_id=$2 OR run_id=$2) AND status='succeeded' AND action_type LIKE 'ai%' ORDER BY created_at LIMIT 1000`,
        [actor.workspaceId, sourceId],
      )
    ).rows;
  });
}
