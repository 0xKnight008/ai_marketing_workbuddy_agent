import { z } from "zod";
import type { ActorContext } from "../contracts/domain";
import type { TenantTransaction } from "../foundation/database";
import { requirePermission } from "../foundation/rbac";
import { HttpError } from "../http/errors";
import { actionPlanSchema } from "../contracts/ai-runtime-event";
import { notificationContentError } from "../insight-service/notification-limits";
import {PLATFORM_LENGTH_LIMITS} from '../../../shared/social-content-limits';
const editSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    content: z.string().trim().min(1).max(12000).optional(),
    subject: z.string().trim().min(1).max(200).optional(),
    actions: z
      .array(
        z
          .object({
            stepOrder: z.number().int().positive(),
            content: z.string().trim().min(1).max(12000),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .optional(),
  })
  .strict();
export async function editApproval(
  tx: TenantTransaction,
  actor: ActorContext,
  id: string,
  body: unknown,
) {
  requirePermission(actor.role, "approval:decide");
  z.string().uuid().parse(id);
  const input = editSchema.parse(body);
  const r = await tx.query<{
    version: number;
    status: string;
    runId:string|null;
    action: Record<string, any>;
  }>(
    'SELECT version,status,run_id AS "runId",requested_action AS action FROM approval_request WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
    [actor.workspaceId, id],
  );
  const row = r.rows[0];
  if (!row) throw new HttpError(404, "approval_not_found");
  if (row.status !== "pending" || row.version !== input.expectedVersion)
    throw new HttpError(409, "approval_version_conflict");
  const action = structuredClone(row.action);
  if (action.actionType === "insight.deliver_report") {
    if (!input.content || input.actions)
      throw new HttpError(422, "approval_content_required");
    const channel = action.parameters.channel;
    const error = notificationContentError(channel, input.content);
    if (error) throw new HttpError(422, error);
    action.parameters.content = input.content;
    if (channel === "email") {
      if (!input.subject) throw new HttpError(422, "approval_subject_required");
      action.parameters.subject = input.subject;
    }
  } else {
    const plan = actionPlanSchema.parse(action);
    const context=await tx.query<{context: {forbiddenWords?:unknown}}>('SELECT context_snapshot AS context FROM workflow_run WHERE workspace_id=$1 AND id=$2',[actor.workspaceId,row.runId]);
    const words=context.rows[0]?.context?.forbiddenWords;
    if (
      !input.actions ||
      input.content ||
      input.subject ||
      input.actions.length !== plan.actions.length
    )
      throw new HttpError(422, "approval_actions_mismatch");
    for (const a of plan.actions) {
      const edits = input.actions.filter((x) => x.stepOrder === a.stepOrder);
      if (edits.length !== 1)
        throw new HttpError(422, "approval_actions_mismatch");
      a.content = edits[0]!.content;
      const publishable=[a.content,...a.hashtags].filter(Boolean).join(' ');
      const limit=PLATFORM_LENGTH_LIMITS[a.platform];
      if(limit!==undefined&&publishable.length>limit)throw new HttpError(422,'approval_content_too_long');
      if(Array.isArray(words)&&words.some(word=>typeof word==='string'&&word&&publishable.toLowerCase().includes(word.toLowerCase())))throw new HttpError(422,'approval_content_forbidden_word');
    }
    Object.assign(action, plan);
  }
  await tx.query(
    "INSERT INTO approval_content_version(workspace_id,approval_id,version,requested_action,edited_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    [actor.workspaceId, id, row.version, row.action, actor.actorId],
  );
  await tx.query(
    "UPDATE approval_request SET requested_action=$3,version=version+1 WHERE workspace_id=$1 AND id=$2",
    [actor.workspaceId, id, action],
  );
  await tx.query(
    "INSERT INTO audit_event(workspace_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4)",
    [
      actor.workspaceId,
      actor.actorId,
      "approval.edited",
      { approvalId: id, version: row.version + 1 },
    ],
  );
  return { id, version: row.version + 1, requestedAction: action };
}
