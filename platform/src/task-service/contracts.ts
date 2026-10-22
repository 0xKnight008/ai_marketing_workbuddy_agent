import { z } from "zod";
export const taskPreferenceSchema = z.object({
  persona: z
    .enum(["creators", "sellers", "community-hosts"])
    .default("creators"),
  modelBand: z.enum(["eco", "standard", "flagship"]).default("standard"),
  language: z.enum(["en", "zh", "es"]).default("en"),
  goal: z.string().trim().max(4000).default(""),
});
export const taskCreateSchema = taskPreferenceSchema.extend({
  goal: z.string().trim().min(1).max(4000),
  batchIds: z.array(z.string().uuid()).max(10).default([]),
  requestId: z.string().uuid(),
  parentTaskId: z.string().uuid().optional(),
});
export const taskMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  requestId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  modelBand: z.enum(["eco", "standard", "flagship"]),
});
export const reasonSchema = z.string().trim().min(3).max(1000);
export const taskStepSchema = z
  .object({
    action: z.enum(["ask", "search", "answer"]),
    query: z.string().max(200).default(""),
    markdown: z.string().max(20000).default(""),
    citations: z
      .array(
        z.object({
          ref: z.string().max(80),
          snippet: z.string().min(1).max(1000),
        }),
      )
      .max(30),
  })
  .superRefine((v, ctx) => {
    if (v.action === "search" && !v.query.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "search_requires_query",
      });
    if (v.action !== "search" && !v.markdown.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "response_requires_markdown",
      });
  });
export type TaskStep = z.infer<typeof taskStepSchema>;
export interface TaskRow {
  id: string;
  workspaceId: string;
  sourceKind: string;
  sourceId: string | null;
  parentTaskId: string | null;
  waitingReason: string | null;
  goal: string;
  persona: string;
  modelBand: string;
  language: string;
  batchIds: string[];
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  createdBy: string;
}
export const taskColumns = `t.id,t.review,t.parent_task_id AS "parentTaskId",(SELECT j.last_error FROM job j WHERE j.workspace_id=t.workspace_id AND j.status='queued' AND j.last_error IN ('ai_credits_deferred','model_choice_required') AND (j.payload->>'taskId'=t.id::text OR (j.payload->>'batchId') IN (SELECT jsonb_array_elements_text(t.batch_ids))) ORDER BY j.updated_at DESC LIMIT 1) AS "waitingReason",t.workspace_id AS "workspaceId",t.source_kind AS "sourceKind",t.source_id AS "sourceId",t.goal,t.persona,t.model_band AS "modelBand",t.language,t.batch_ids AS "batchIds",t.version,t.created_at::text AS "createdAt",t.updated_at::text AS "updatedAt",t.archived_at::text AS "archivedAt",t.created_by AS "createdBy",
 CASE t.source_kind WHEN 'report' THEN CASE r.status WHEN 'generated' THEN 'completed' WHEN 'generating' THEN 'running' WHEN 'pending' THEN 'queued' ELSE 'failed' END WHEN 'import' THEN CASE b.status WHEN 'classified' THEN 'completed' WHEN 'classifying' THEN 'running' WHEN 'pending' THEN 'queued' ELSE 'failed' END WHEN 'workflow' THEN CASE WHEN w.status='succeeded' THEN 'completed' WHEN w.status IN ('failed','dead_lettered','cancelled','timed_out') THEN 'failed' WHEN w.status='running' THEN 'running' ELSE 'queued' END ELSE t.status END AS status`;
export const taskJoins = `FROM workspace_task t LEFT JOIN insight_report r ON t.source_kind='report' AND r.id=t.source_id AND r.workspace_id=t.workspace_id LEFT JOIN import_batch b ON t.source_kind='import' AND b.id=t.source_id AND b.workspace_id=t.workspace_id LEFT JOIN workflow_run w ON t.source_kind='workflow' AND w.id=t.source_id AND w.workspace_id=t.workspace_id`;
