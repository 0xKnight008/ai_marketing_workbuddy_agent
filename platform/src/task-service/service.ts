import { createHash } from "node:crypto";
import { z } from "zod";
import type { ActorContext, WorkspaceRole } from "../contracts/domain";
import type { Database, TenantTransaction } from "../foundation/database";
import { requirePermission } from "../foundation/rbac";
import { requireAutomationAccess } from "../billing/guardrails";
import { HttpError } from "../http/errors";
import {
  taskCreateSchema,
  taskMessageSchema,
  taskPreferenceSchema,
  reasonSchema,
  taskColumns,
  taskJoins,
  type TaskRow,
} from "./contracts";

export async function taskActor(
  tx: TenantTransaction,
  actor: ActorContext,
  write = false,
) {
  const member = await tx.query<{ role: WorkspaceRole }>(
    "SELECT role FROM workspace_membership WHERE workspace_id=$1 AND user_id=$2",
    [actor.workspaceId, actor.actorId],
  );
  if (!member.rows[0])
    throw new HttpError(403, "workspace_membership_required");
  if (write) requirePermission(member.rows[0].role, "workflow:run");
  return member.rows[0].role;
}
export async function taskAudit(
  tx: TenantTransaction,
  actor: ActorContext,
  event: string,
  payload: Record<string, unknown>,
) {
  await tx.query(
    "INSERT INTO audit_event(workspace_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4)",
    [actor.workspaceId, actor.actorId, event, payload],
  );
}
export async function findTask(tx: TenantTransaction, id: string) {
  const result = await tx.query<TaskRow>(
    `SELECT ${taskColumns} ${taskJoins} WHERE t.workspace_id=current_setting('app.workspace_id')::uuid AND t.id=$1`,
    [id],
  );
  if (!result.rows[0]) throw new HttpError(404, "task_not_found");
  return result.rows[0];
}
export class TaskService {
  constructor(private readonly database: Database) {}
  // Canonical wrappers preserve legacy records and receive one stable ID across devices.
  async syncLegacy(tx: TenantTransaction) {
    await tx.query(
      `INSERT INTO workspace_task(workspace_id,source_kind,source_id,goal,persona,language,model_band,batch_ids,created_by,created_at,updated_at) SELECT workspace_id,'report',id,left(title,4000),CASE template WHEN 'review_attribution' THEN 'sellers' WHEN 'community_digest' THEN 'community-hosts' ELSE 'creators' END,CASE WHEN report->>'_language' IN ('en','zh','es') THEN report->>'_language' ELSE 'en' END,model_band,batch_ids,created_by,created_at,created_at FROM insight_report WHERE workspace_id=current_setting('app.workspace_id')::uuid ON CONFLICT(workspace_id,source_kind,source_id) DO NOTHING`,
    );
    await tx.query(
      `INSERT INTO workspace_task(workspace_id,source_kind,source_id,goal,model_band,batch_ids,created_by,created_at,updated_at) SELECT workspace_id,'import',id,left(label,4000),model_band,jsonb_build_array(id::text),created_by,created_at,created_at FROM import_batch WHERE workspace_id=current_setting('app.workspace_id')::uuid AND status='failed' AND NOT EXISTS(SELECT 1 FROM workspace_task c WHERE c.workspace_id=import_batch.workspace_id AND c.source_kind='conversation' AND c.batch_ids @> jsonb_build_array(import_batch.id::text)) ON CONFLICT(workspace_id,source_kind,source_id) DO NOTHING`,
    );
    await tx.query(
      `INSERT INTO workspace_task(workspace_id,source_kind,source_id,goal,created_by,created_at,updated_at) SELECT r.workspace_id,'workflow',r.id,left(w.name,4000),r.requested_by,r.created_at,r.created_at FROM workflow_run r JOIN workflow w ON w.id=r.workflow_id AND w.workspace_id=r.workspace_id WHERE r.workspace_id=current_setting('app.workspace_id')::uuid ON CONFLICT(workspace_id,source_kind,source_id) DO NOTHING`,
    );
  }
  async list(actor: ActorContext, query: unknown) {
    const input = z
      .object({
        archived: z.enum(["0", "1"]).default("0"),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        kind: z
          .enum(["conversation", "report", "import", "workflow"])
          .optional(),
        status: z
          .enum(["ready", "queued", "running", "completed", "failed"])
          .optional(),
      })
      .parse(query ?? {});
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor);
      await this.syncLegacy(tx);
      const rows = await tx.query<TaskRow>(
        `SELECT * FROM(SELECT ${taskColumns} ${taskJoins} WHERE t.workspace_id=$1 AND (t.archived_at IS NOT NULL)=$2) scoped WHERE ($4::text IS NULL OR scoped.\"sourceKind\"=$4) AND ($5::text IS NULL OR scoped.status=$5) ORDER BY scoped.\"updatedAt\" DESC,scoped.id DESC LIMIT 50 OFFSET $3`,
        [
          actor.workspaceId,
          input.archived === "1",
          input.offset,
          input.kind ?? null,
          input.status ?? null,
        ],
      );
      return rows.rows;
    });
  }
  async detail(actor: ActorContext, id: unknown) {
    const taskId = z.string().uuid().parse(id);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor);
      const task = await findTask(tx, taskId);
      const messages = await tx.query(
        `SELECT id,role,content,status,model_band AS "modelBand",citations,error,created_at::text AS "createdAt",COALESCE((SELECT jsonb_agg(jsonb_build_object('step',e.attempt,'band',e.model_band,'provider',e.supplier,'credits',e.ai_credits) ORDER BY e.created_at) FROM task_event e WHERE e.workspace_id=m.workspace_id AND e.subject_id=m.id AND e.action_type='ai.task' AND e.status='succeeded'),'[]'::jsonb) AS executions FROM workspace_task_message m WHERE workspace_id=$1 AND task_id=$2 ORDER BY sequence`,
        [actor.workspaceId, taskId],
      );
      return { task, messages: messages.rows };
    });
  }
  async create(actor: ActorContext, body: unknown) {
    const input = taskCreateSchema.parse(body),
      fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor, true);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `task-create:${actor.workspaceId}:${input.requestId}`,
      ]);
      const exists = await tx.query<TaskRow>(
        `SELECT ${taskColumns} ${taskJoins} WHERE t.workspace_id=$1 AND t.id=$2`,
        [actor.workspaceId, input.requestId],
      );
      if (exists.rows[0]) {
        const original = await tx.query<{ fingerprint: string }>(
          "SELECT creation_fingerprint AS fingerprint FROM workspace_task WHERE workspace_id=$1 AND id=$2",
          [actor.workspaceId, input.requestId],
        );
        if (original.rows[0]?.fingerprint !== fingerprint)
          throw new HttpError(409, "task_request_conflict");
        return exists.rows[0];
      }
      await requireAutomationAccess(tx);
      if (input.parentTaskId) {
        const parent = await findTask(tx, input.parentTaskId);
        if (!input.batchIds.length) input.batchIds = parent.batchIds;
      }
      if (input.batchIds.length) {
        const found = await tx.query(
          "SELECT id FROM import_batch WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='classified'",
          [actor.workspaceId, input.batchIds],
        );
        if (found.rowCount !== new Set(input.batchIds).size)
          throw new HttpError(422, "task_sources_not_ready");
      }
      await tx.query(
        `INSERT INTO workspace_task(id,workspace_id,goal,persona,model_band,language,batch_ids,created_by,creation_fingerprint,parent_task_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING`,
        [
          input.requestId,
          actor.workspaceId,
          input.goal,
          input.persona,
          input.modelBand,
          input.language,
          JSON.stringify([...new Set(input.batchIds)]),
          actor.actorId,
          fingerprint,
          input.parentTaskId ?? null,
        ],
      );
      const task = await findTask(tx, input.requestId);
      await taskAudit(tx, actor, "task.created", {
        taskId: task.id,
        batchIds: task.batchIds,
      });
      return task;
    });
  }
  async message(actor: ActorContext, id: unknown, body: unknown) {
    const taskId = z.string().uuid().parse(id),
      input = taskMessageSchema.parse(body);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor, true);
      await tx.query(
        "SELECT id FROM workspace_task WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [actor.workspaceId, taskId],
      );
      const task = await findTask(tx, taskId);
      const replay = await tx.query<{ id: string }>(
        "SELECT id FROM workspace_task_message WHERE task_id=$1 AND workspace_id=$2 AND request_id=$3 AND role='assistant'",
        [taskId, actor.workspaceId, input.requestId],
      );
      if (replay.rows[0]) {
        const original = await tx.query<{ content: string; modelBand: string }>(
          "SELECT content,model_band AS \"modelBand\" FROM workspace_task_message WHERE workspace_id=$1 AND task_id=$2 AND request_id=$3 AND role='user'",
          [actor.workspaceId, taskId, input.requestId],
        );
        if (
          original.rows[0]?.content !== input.message ||
          original.rows[0]?.modelBand !== input.modelBand
        )
          throw new HttpError(409, "task_request_conflict");
        return { messageId: replay.rows[0].id, version: task.version };
      }
      if (task.sourceKind !== "conversation" || task.archivedAt)
        throw new HttpError(409, "task_not_editable");
      if (task.version !== input.expectedVersion)
        throw new HttpError(409, "task_version_conflict");
      if (["queued", "running"].includes(task.status))
        throw new HttpError(409, "task_turn_in_progress");
      await requireAutomationAccess(tx);
      await tx.query(
        `INSERT INTO workspace_task_message(workspace_id,task_id,request_id,role,content,model_band,created_by) VALUES($1,$2,$3,'user',$4,$5,$6)`,
        [
          actor.workspaceId,
          taskId,
          input.requestId,
          input.message,
          input.modelBand,
          actor.actorId,
        ],
      );
      const reply = await tx.query<{ id: string }>(
        `INSERT INTO workspace_task_message(workspace_id,task_id,request_id,role,status,model_band,created_by) VALUES($1,$2,$3,'assistant','queued',$4,$5) RETURNING id`,
        [
          actor.workspaceId,
          taskId,
          input.requestId,
          input.modelBand,
          actor.actorId,
        ],
      );
      const messageId = reply.rows[0]!.id;
      await tx.query(
        "UPDATE workspace_task SET status='queued',model_band=$3,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [actor.workspaceId, taskId, input.modelBand],
      );
      await tx.query(
        "INSERT INTO job(workspace_id,kind,payload) VALUES($1,'task.turn',$2)",
        [actor.workspaceId, { taskId, messageId }],
      );
      await taskAudit(tx, actor, "task.turn_queued", {
        taskId,
        messageId,
        modelBand: input.modelBand,
      });
      return { messageId, version: task.version + 1 };
    });
  }
  async archive(actor: ActorContext, id: unknown, body: unknown) {
    const taskId = z.string().uuid().parse(id),
      input = z
        .object({ archived: z.boolean(), reason: reasonSchema })
        .parse(body);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor, true);
      await tx.query(
        "SELECT id FROM workspace_task WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [actor.workspaceId, taskId],
      );
      const task = await findTask(tx, taskId);
      if (input.archived && task.status !== "failed")
        throw new HttpError(409, "only_failed_tasks_can_be_removed");
      if (input.archived) {
        const active = await tx.query(
          `SELECT id FROM job WHERE workspace_id=$1 AND status IN ('queued','running') AND (payload->>'taskId'=$2 OR (run_id=$3::uuid AND $3::uuid IS NOT NULL) OR payload->>'reportId'=$3::text OR payload->>'batchId'=$3::text) LIMIT 1`,
          [actor.workspaceId, taskId, task.sourceId],
        );
        if (active.rowCount) throw new HttpError(409, "task_job_still_active");
      }
      await tx.query(
        "UPDATE workspace_task SET archived_at=CASE WHEN $3 THEN now() ELSE NULL END,archived_by=CASE WHEN $3 THEN $4::uuid ELSE NULL END,archive_reason=CASE WHEN $3 THEN $5 ELSE NULL END,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [
          actor.workspaceId,
          taskId,
          input.archived,
          actor.actorId,
          input.reason,
        ],
      );
      await taskAudit(
        tx,
        actor,
        input.archived ? "task.removed" : "task.restored",
        {
          taskId,
          sourceKind: task.sourceKind,
          sourceId: task.sourceId,
          reason: input.reason,
        },
      );
      return findTask(tx, taskId);
    });
  }
  async evidence(actor: ActorContext, id: unknown, ref: unknown) {
    const taskId = z.string().uuid().parse(id),
      itemId = z.string().uuid().parse(ref);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor);
      const task = await findTask(tx, taskId);
      const item = await tx.query(
        "SELECT id,text,author,platform FROM import_item WHERE workspace_id=$1 AND id=$2 AND batch_id=ANY($3::uuid[])",
        [actor.workspaceId, itemId, task.batchIds],
      );
      if (!item.rows[0]) throw new HttpError(404, "task_evidence_not_found");
      return item.rows[0];
    });
  }
  async saveReview(actor: ActorContext, id: unknown, body: unknown) {
    const taskId = z.string().uuid().parse(id),
      input = z
        .object({
          messageId: z.string().uuid(),
          refs: z.array(z.string().uuid()).max(30),
        })
        .parse(body);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor, true);
      await tx.query(
        "SELECT id FROM workspace_task WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [actor.workspaceId, taskId],
      );
      const task = await findTask(tx, taskId);
      if (task.archivedAt) throw new HttpError(409, "task_not_editable");
      const message = await tx.query<{ citations: Array<{ ref: string }> }>(
        "SELECT citations FROM workspace_task_message WHERE workspace_id=$1 AND task_id=$2 AND id=$3 AND role='assistant' AND status='completed'",
        [actor.workspaceId, taskId, input.messageId],
      );
      if (
        !message.rows[0] ||
        input.refs.some(
          (ref) => !message.rows[0]!.citations.some((c) => c.ref === ref),
        )
      )
        throw new HttpError(422, "task_review_invalid_evidence");
      const review = {
        messageId: input.messageId,
        refs: [...new Set(input.refs)],
        checkedBy: actor.actorId,
        checkedAt: new Date().toISOString(),
      };
      await tx.query(
        "UPDATE workspace_task SET review=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2",
        [actor.workspaceId, taskId, review],
      );
      await taskAudit(tx, actor, "task.review_saved", { taskId, ...review });
      return review;
    });
  }
  async resume(actor: ActorContext, id: unknown, body: unknown) {
    const taskId = z.string().uuid().parse(id),
      input = z.object({ reason: reasonSchema }).parse(body);
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor, true);
      const task = await findTask(tx, taskId);
      if (task.archivedAt) throw new HttpError(409, "task_not_editable");
      await requireAutomationAccess(tx);
      const jobs = await tx.query(
        "UPDATE job SET available_at=now(),updated_at=now() WHERE workspace_id=$1 AND status='queued' AND last_error='ai_credits_deferred' AND (payload->>'taskId'=$2 OR payload->>'batchId'=ANY($3::text[])) RETURNING id",
        [actor.workspaceId, taskId, task.batchIds],
      );
      await taskAudit(tx, actor, "task.resumed", {
        taskId,
        reason: input.reason,
        jobs: jobs.rowCount,
      });
      return { resumedJobs: jobs.rowCount };
    });
  }
  async preferences(actor: ActorContext, body?: unknown) {
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await taskActor(tx, actor);
      if (body !== undefined) {
        const input = taskPreferenceSchema.parse(body);
        await tx.query(
          `INSERT INTO workspace_task_preference(workspace_id,user_id,persona,model_band,language,goal) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,user_id) DO UPDATE SET persona=EXCLUDED.persona,model_band=EXCLUDED.model_band,language=EXCLUDED.language,goal=EXCLUDED.goal,updated_at=now()`,
          [
            actor.workspaceId,
            actor.actorId,
            input.persona,
            input.modelBand,
            input.language,
            input.goal,
          ],
        );
        await taskAudit(tx, actor, "task.preferences_updated", {
          persona: input.persona,
          modelBand: input.modelBand,
          language: input.language,
        });
      }
      const saved = await tx.query(
        'SELECT persona,model_band AS "modelBand",language,goal FROM workspace_task_preference WHERE workspace_id=$1 AND user_id=$2',
        [actor.workspaceId, actor.actorId],
      );
      return saved.rows[0] ?? taskPreferenceSchema.parse({});
    });
  }
}
