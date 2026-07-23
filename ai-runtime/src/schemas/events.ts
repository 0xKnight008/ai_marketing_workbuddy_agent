import { z } from 'zod';

/**
 * ai-runtime → run-service 事件契约（架构文档 §7）。
 * 事件是 ai-runtime 唯一的“反向通道”，MVP 阶段 run-service 也可以只轮询
 * GET /internal/ai-runs/{aiRunId}，事件作为增强而非必需。
 */

export const aiRuntimeEventTypeEnum = z.enum([
  'ai_run.started',
  'ai_step.started',
  'ai_step.succeeded',
  'ai_step.failed',
  'draft.created',
  'action_plan.created',
  'ai_run.succeeded',
  'ai_run.failed',
]);
export type AiRuntimeEventType = z.infer<typeof aiRuntimeEventTypeEnum>;

export const aiRuntimeEventSchema = z.object({
  eventId: z.string(),
  platformRunId: z.string(),
  aiRunId: z.string(),
  type: aiRuntimeEventTypeEnum,
  createdAt: z.string().datetime(),
  payload: z.record(z.unknown()).default({}),
});
export type AiRuntimeEvent = z.infer<typeof aiRuntimeEventSchema>;

/** workflow 内的逻辑 step id，与 prepare-announcement-workflow 保持一致 */
export const WORKFLOW_STEP_IDS = {
  contentPlanning: 'content-planning',
  copyOptimization: 'copy-optimization',
  complianceCheck: 'compliance-check',
  buildActionPlan: 'build-action-plan',
} as const;
export type WorkflowStepId = (typeof WORKFLOW_STEP_IDS)[keyof typeof WORKFLOW_STEP_IDS];
