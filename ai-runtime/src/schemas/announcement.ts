import { z } from 'zod';

/**
 * Structured schemas owned by ai-runtime (见架构文档 §9 数据归属)。
 * run-service / gateway 只消费这些结构，不在 ai-runtime 之外重新定义。
 */

/** connector-service 维护的高频平台能力矩阵（§3.3） */
export const platformEnum = z.enum([
  'instagram',
  'tiktok',
  'youtube',
  'linkedin',
  'x',
  'discord',
  'reddit',
  'substack',
  'telegram',
  'rednote',
]);
export type Platform = z.infer<typeof platformEnum>;

export const targetSchema = z.object({
  platform: platformEnum,
  accountId: z.string().min(1),
});
export type Target = z.infer<typeof targetSchema>;

const targetsSchema = z
  .array(targetSchema)
  .min(1)
  .superRefine((targets, ctx) => {
    const seen = new Set<string>();
    for (const [index, target] of targets.entries()) {
      const key = `${target.platform}:${target.accountId}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `Duplicate target: ${key}`,
        });
      }
      seen.add(key);
    }
  });

/** Gateway 组装好的品牌上下文（§8：ai-runtime 只消费、不持久化） */
export const brandProfileSchema = z.object({
  tone: z.string().default('clear, concise, helpful'),
  forbiddenWords: z.array(z.string()).default([]),
  language: z.string().default('zh'),
});
export type BrandProfile = z.infer<typeof brandProfileSchema>;

export const runPolicySchema = z.object({
  approvalRequiredForPublish: z.boolean().default(true),
});
export type RunPolicy = z.infer<typeof runPolicySchema>;

export const executionContextSchema = z.object({
  brandProfile: brandProfileSchema.default({}),
  priorApprovedExamples: z.array(z.string()).default([]),
  approvalPolicy: z.enum(['required', 'auto_approve', 'none']).default('required'),
  runPolicy: runPolicySchema.default({}),
});
export type ExecutionContext = z.infer<typeof executionContextSchema>;

export const prepareAnnouncementInputSchema = z.object({
  mode: z.enum(['draft', 'publish']).default('draft'),
  brief: z.string().min(1),
  targets: targetsSchema,
});
export type PrepareAnnouncementInput = z.infer<typeof prepareAnnouncementInputSchema>;

/** run-service → ai-runtime 的内部请求（§5.4） */
export const prepareAnnouncementRequestSchema = z.object({
  platformRunId: z.string().min(1),
  workspaceId: z.string().min(1),
  actorId: z.string().min(1),
  input: prepareAnnouncementInputSchema,
  executionContext: executionContextSchema.default({}),
}).strict();
export type PrepareAnnouncementRequest = z.infer<typeof prepareAnnouncementRequestSchema>;

/* ------------------------------------------------------------------ */
/* Agent 结构化输出                                                    */
/* ------------------------------------------------------------------ */

/** Step 1: announcement-planner-agent 输出 —— 每个 target 的内容策略 */
export const targetPlanSchema = z.object({
  platform: platformEnum,
  accountId: z.string().min(1),
  angle: z.string().describe('该平台的内容切入角度'),
  keyPoints: z.array(z.string()).min(1),
  callToAction: z.string().optional(),
  contentFormat: z.enum(['text', 'text_with_image', 'thread', 'video_script']).default('text'),
});
export type TargetPlan = z.infer<typeof targetPlanSchema>;

export const contentPlanSchema = z.object({
  summary: z.string(),
  perTarget: z.array(targetPlanSchema).min(1),
});
export type ContentPlan = z.infer<typeof contentPlanSchema>;

/** Step 2: copy-optimization-agent 输出 —— 平台化文案草稿 */
export const draftSchema = z.object({
  platform: platformEnum,
  accountId: z.string().min(1),
  content: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  characterCount: z.number().int().nonnegative(),
});
export type Draft = z.infer<typeof draftSchema>;

export const draftSetSchema = z.object({
  drafts: z.array(draftSchema).min(1),
});
export type DraftSet = z.infer<typeof draftSetSchema>;

/** Step 3: compliance-checker-agent 输出 —— 执行时校验结果 */
export const complianceIssueSchema = z.object({
  platform: platformEnum.optional(),
  accountId: z.string().optional(),
  severity: z.enum(['info', 'warning', 'blocker']),
  rule: z.string().describe('触发的规则，如 forbidden_word / length_limit / tone_mismatch'),
  message: z.string(),
});
export type ComplianceIssue = z.infer<typeof complianceIssueSchema>;

export const complianceReportSchema = z.object({
  passed: z.boolean(),
  issues: z.array(complianceIssueSchema).default([]),
});
export type ComplianceReport = z.infer<typeof complianceReportSchema>;

/** Step 4 产物：交给 run-service 审批并按序执行的多步骤 action plan（§12.2） */
export const plannedActionSchema = z.object({
  stepOrder: z.number().int().positive(),
  type: z.literal('social.create_post'),
  platform: platformEnum,
  accountId: z.string(),
  content: z.string(),
  hashtags: z.array(z.string()).default([]),
  mode: z.enum(['publish_now', 'schedule']).default('publish_now'),
  scheduledAt: z.string().datetime().optional(),
  /** 与 §5.5 约定一致：`{platformRunId}:post:{platform}:{accountId}` */
  idempotencyKey: z.string(),
  requiresApproval: z.boolean(),
});
export type PlannedAction = z.infer<typeof plannedActionSchema>;

export const actionPlanSchema = z.object({
  summary: z.string(),
  requiresApproval: z.boolean(),
  actions: z.array(plannedActionSchema),
});
export type ActionPlan = z.infer<typeof actionPlanSchema>;

/** workflow 最终返回给 run-service 的完整结果 */
export const prepareAnnouncementResultSchema = z.object({
  contentPlan: contentPlanSchema,
  drafts: z.array(draftSchema),
  compliance: complianceReportSchema,
  actionPlan: actionPlanSchema,
});
export type PrepareAnnouncementResult = z.infer<typeof prepareAnnouncementResultSchema>;
