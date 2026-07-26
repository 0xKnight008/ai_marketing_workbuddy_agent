import { z } from 'zod';

const plannedActionSchema = z.object({
  stepOrder: z.number().int().positive(),
  type: z.enum(['social.create_post', 'social.schedule_post']),
  platform: z.string().min(1),
  accountId: z.string().min(1),
  content: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  mode: z.enum(['publish_now', 'schedule']).default('publish_now'),
  scheduledAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  requiresApproval: z.boolean(),
}).strict();

export const actionPlanSchema = z.object({
  summary: z.string(),
  requiresApproval: z.boolean(),
  actions: z.array(plannedActionSchema),
}).strict();
export type ActionPlan = z.infer<typeof actionPlanSchema>;

export const aiRuntimeEventSchema = z.object({
  eventId: z.string().min(1),
  platformRunId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  aiRunId: z.string().min(1),
  type: z.enum([
    'ai_run.started', 'ai_step.started', 'ai_step.succeeded', 'ai_step.failed',
    'draft.created', 'action_plan.created', 'ai_run.succeeded', 'ai_run.failed',
  ]),
  createdAt: z.string().datetime(),
  payload: z.record(z.unknown()).default({}),
}).strict();
export type AiRuntimeEvent = z.infer<typeof aiRuntimeEventSchema>;
