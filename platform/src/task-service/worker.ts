import {finishCost} from '../billing/cost-metering';
import {settleAiReservations} from '../billing/ai-refunds';
import type {
  RunWorkerDatabase,
  ClaimedJob,
} from "../run-service/worker-runner";
import { reserveAiRun } from "../billing/guardrails";
import type { ModelBand } from "../billing/plans";
import { taskStepSchema, type TaskStep } from "./contracts";
import { findTask, taskActor } from "./service";

type Source = { ref: string; text: string; batchId: string };
type StoredStep = { result: TaskStep; sources: Source[] };
export interface TaskRuntime {
  taskStep(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export async function executeTaskTurn(
  database: RunWorkerDatabase,
  runtime: TaskRuntime,
  job: ClaimedJob,
) {
  const taskId = String(job.payload.taskId),
    messageId = String(job.payload.messageId);
  for (let iteration = 0; iteration < 4; iteration++) {
    const prepared = await database.withWorkspace(
      job.workspaceId,
      async (tx) => {
        const task = await findTask(tx, taskId);
        if (task.archivedAt)
          throw new Error("task_archived_restore_before_replay");
        const found = await tx.query<{
          id: string;
          status: string;
          modelBand: ModelBand;
          createdBy: string;
          steps: StoredStep[];
          requestId: string;
        }>(
          `SELECT id,status,model_band AS "modelBand",created_by AS "createdBy",steps,request_id AS "requestId" FROM workspace_task_message WHERE workspace_id=$1 AND task_id=$2 AND id=$3 AND role='assistant' FOR UPDATE`,
          [job.workspaceId, taskId, messageId],
        );
        const reply = found.rows[0];
        if (!reply) throw new Error("task_reply_missing");
        if (reply.status === "completed") {
          await tx.query(
            "UPDATE job SET status='succeeded',locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$2",
            [job.id, job.workspaceId],
          );
          return null;
        }
        await taskActor(
          tx,
          {
            actorId: reply.createdBy,
            workspaceId: job.workspaceId,
            role: "viewer",
          },
          true,
        );
        if (task.batchIds.length) {
          const batches = await tx.query<{ status: string }>(
            "SELECT status FROM import_batch WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
            [job.workspaceId, task.batchIds],
          );
          if (
            batches.rowCount !== task.batchIds.length ||
            batches.rows.some((b) => b.status === "failed")
          )
            throw new Error("task_source_import_failed");
          if (batches.rows.some((b) => b.status !== "classified")) {
            await tx.query(
              "UPDATE job SET status='queued',attempt=GREATEST(attempt-1,0),available_at=now()+interval '10 seconds',locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$2",
              [job.id, job.workspaceId],
            );
            return null;
          }
        }
        const history = await tx.query<{ role: string; content: string }>(
          `SELECT role,content FROM (SELECT role,content,sequence FROM workspace_task_message WHERE workspace_id=$1 AND task_id=$2 AND status='completed' AND sequence < (SELECT sequence FROM workspace_task_message WHERE id=$3 AND workspace_id=$1) ORDER BY sequence DESC LIMIT 24) h ORDER BY sequence`,
          [job.workspaceId, taskId, messageId],
        );
        const sourceRows = await tx.query<{
          id: string;
          text: string;
          batchId: string;
        }>(
          `SELECT id,left(text,2000) AS text,batch_id AS "batchId" FROM import_item WHERE workspace_id=$1 AND batch_id=ANY($2::uuid[]) ORDER BY created_at,id LIMIT 40`,
          [job.workspaceId, task.batchIds],
        );
        const initial: Source[] = sourceRows.rows.map((row) => ({
          ref: row.id,
          text: row.text,
          batchId: row.batchId,
        }));
        let sourceBudget = 24000;
        const sources = Array.from(
          new Map(
            [
              ...reply.steps.flatMap((step) => step.sources).reverse(),
              ...initial,
            ].map((source) => [source.ref, source]),
          ).values(),
        ).filter((source) => {
          sourceBudget -= source.text.length;
          return sourceBudget >= 0;
        });
        let priorResult = "";
        const parent = await tx.query<{ sourceKind: string; sourceId: string }>(
          `SELECT p.source_kind AS "sourceKind",p.source_id AS "sourceId" FROM workspace_task t JOIN workspace_task p ON p.id=t.parent_task_id AND p.workspace_id=t.workspace_id WHERE t.workspace_id=$1 AND t.id=$2`,
          [job.workspaceId, task.id],
        );
        if (parent.rows[0]?.sourceKind === "report") {
          const report = await tx.query<{ summary: string }>(
            `SELECT left(report->>'summary',6000) AS summary FROM insight_report WHERE workspace_id=$1 AND id=$2`,
            [job.workspaceId, parent.rows[0].sourceId],
          );
          priorResult = report.rows[0]?.summary ?? "";
        }
        const final = reply.steps.at(-1)?.result;
        if ((final && final.action !== "search") || reply.steps.length >= 4)
          return {
            task,
            reply,
            history: boundedHistory(history.rows),
            priorResult,
            sources,
            final: final?.action === "search" ? undefined : final,
          };
        const reservation = await reserveAiRun(
          tx,
          [(job.payload.modelBandOverride ?? reply.modelBand) as ModelBand],
          {
            subjectId: reply.id,
            attempt: reply.steps.length + 1,
            actionType: "ai.task",
          },
          (job.payload.modelBandOverride ?? reply.modelBand) as ModelBand,
        );
        if (
          !reservation.replayed &&
          reservation.guardrail.status === "paused"
        ) {
          await tx.query(
            "UPDATE job SET status='queued',attempt=GREATEST(attempt-1,0),available_at=now()+interval '6 hours',locked_at=NULL,locked_by=NULL,last_error='ai_credits_deferred',updated_at=now() WHERE id=$1 AND workspace_id=$2",
            [job.id, job.workspaceId],
          );
          return null;
        }
        await tx.query(
          "UPDATE workspace_task SET status='running',updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [job.workspaceId, taskId],
        );
        await tx.query(
          "UPDATE workspace_task_message SET status='running' WHERE workspace_id=$1 AND id=$2",
          [job.workspaceId, messageId],
        );
        return {
          task,
          reply,
          history: boundedHistory(history.rows),
          priorResult,
          sources,
          provider: reservation.provider,
          band: reservation.band,
          final: undefined,
        };
      },
    );
    if (!prepared) return;
    let result: TaskStep;
    if (prepared.final) result = prepared.final;
    else if (prepared.reply.steps.length >= 4)
      result = {
        action: "ask",
        query: "",
        markdown:
          prepared.task.language === "zh"
            ? "请缩小目标或指定需要核对的素材，再继续分析。"
            : prepared.task.language === "es"
              ? "Acota el objetivo o indica las fuentes que debemos revisar."
              : "Please narrow the goal or identify the sources to examine before continuing.",
        citations: [],
      };
    else
      result = taskStepSchema.parse(
        await runtime.taskStep({
          taskId: prepared.task.id,
          goal: prepared.task.goal,
          language: prepared.task.language,
          history: prepared.history,
          priorResult: prepared.priorResult,
          sources: prepared.sources,
          steps: prepared.reply.steps.map((s) => s.result),
          remainingSteps: 4 - prepared.reply.steps.length,
          modelBand: prepared.band,
          provider: prepared.provider,
        }),
      );
    await database.withWorkspace(job.workspaceId, async (tx) => {
      let extra: Source[] = [];
      if (result.action === "search") {
        const rows = await tx.query<{
          id: string;
          text: string;
          batchId: string;
        }>(
          `SELECT id,left(text,2000) AS text,batch_id AS "batchId" FROM import_item WHERE workspace_id=$1 AND batch_id=ANY($2::uuid[]) AND text ILIKE '%'||$3||'%' ESCAPE '\\' ORDER BY created_at,id LIMIT 20`,
          [
            job.workspaceId,
            prepared.task.batchIds,
            result.query.trim().replace(/[\\%_]/g, "\\$&"),
          ],
        );
        extra = rows.rows.map((row) => ({
          ref: row.id,
          text: row.text,
          batchId: row.batchId,
        }));
      } else {
        const sourceMap = new Map(
          prepared.sources.map((source) => [source.ref, source.text]),
        );
        if (
          result.citations.some(
            (c) => !sourceMap.get(c.ref)?.includes(c.snippet),
          )
        )
          throw new Error("task_unverified_citation");
      }
      if (!prepared.final) await settleAiReservations(tx,{subjectId:messageId,actionType:'ai.task',attempt:prepared.reply.steps.length+1});
      if (!prepared.final)
        await tx.query(
          "UPDATE workspace_task_message SET steps=steps||$3::jsonb WHERE workspace_id=$1 AND id=$2",
          [
            job.workspaceId,
            messageId,
            JSON.stringify([{ result, sources: extra }]),
          ],
        );
      if (result.action === "search") return;
      await tx.query(
        "UPDATE workspace_task_message SET status='completed',content=$3,citations=$4,error=NULL WHERE workspace_id=$1 AND id=$2",
        [
          job.workspaceId,
          messageId,
          result.markdown,
          JSON.stringify(result.citations),
        ],
      );
      await tx.query(
        "UPDATE workspace_task SET status=$3,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [
          job.workspaceId,
          taskId,
          result.action === "ask" ? "ready" : "completed",
        ],
      );
      await finishCost(tx,messageId);
      await tx.query(
        "UPDATE job SET status='succeeded',locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$2",
        [job.id, job.workspaceId],
      );
      await tx.query(
        "INSERT INTO audit_event(workspace_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4)",
        [
          job.workspaceId,
          prepared.reply.createdBy,
          "task.turn_completed",
          {
            taskId,
            messageId,
            action: result.action,
            steps: prepared.reply.steps.length + 1,
          },
        ],
      );
    });
    if (result.action !== "search") return;
  }
  // A bounded planning pass resumes from persisted steps without repeating completed calls.
  await database.withWorkspace(job.workspaceId, (tx) =>
    tx.query(
      "UPDATE job SET status='queued',attempt=GREATEST(attempt-1,0),available_at=now(),locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$2",
      [job.id, job.workspaceId],
    ),
  );
}

function boundedHistory(rows: Array<{ role: string; content: string }>) {
  let budget = 16000;
  return rows
    .slice()
    .reverse()
    .map((row) => ({ ...row, content: row.content.slice(0, 4000) }))
    .filter((row) => {
      budget -= row.content.length;
      return budget >= 0;
    })
    .reverse();
}
