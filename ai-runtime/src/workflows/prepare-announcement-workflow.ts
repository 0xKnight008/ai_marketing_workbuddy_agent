import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { announcementPlannerAgent } from '../agents/announcement-planner-agent';
import { copyOptimizationAgent } from '../agents/copy-optimization-agent';
import { complianceCheckerAgent } from '../agents/compliance-checker-agent';
import { getEmitter } from '../events/emitter';
import { resolveApprovalRequirement } from '../lib/approval-policy';
import { runDeterministicChecks } from '../lib/deterministic-checks';
import { assertTargetsMatch } from '../lib/target-validation';
import {
  actionPlanSchema,
  complianceReportSchema,
  contentPlanSchema,
  draftSetSchema,
  executionContextSchema,
  prepareAnnouncementInputSchema,
  prepareAnnouncementResultSchema,
  type ComplianceIssue,
  type ExecutionContext,
  type PlannedAction,
} from '../schemas/announcement';
import { WORKFLOW_STEP_IDS } from '../schemas/events';
import { withStepEvents } from './step-events';

/**
 * prepare-announcement-workflow（架构文档 §3.5 / §4.2）。
 *
 * 四个 step 串行执行，产出交给 run-service 审批的多步骤 action plan（§12.2）。
 * ai-runtime 只负责规划与结构化生成，不执行任何外部副作用动作。
 *
 * 执行上下文（品牌资料、审批策略、platformRunId）随 step 输入输出显式传递，
 * 保证每个 step 的契约自包含、可独立测试。
 */

const workflowInputSchema = z.object({
  platformRunId: z.string(),
  workspaceId: z.string(),
  actorId: z.string(),
  input: prepareAnnouncementInputSchema,
  executionContext: executionContextSchema,
});

/** step 间传递的流水线数据 */
const pipelineContextSchema = z.object({
  platformRunId: z.string(),
  executionContext: executionContextSchema,
  targets: prepareAnnouncementInputSchema.shape.targets,
  contentPlan: contentPlanSchema,
});

const draftsPipelineSchema = pipelineContextSchema.extend({
  drafts: draftSetSchema.shape.drafts,
});

const compliancePipelineSchema = draftsPipelineSchema.extend({
  compliance: complianceReportSchema,
});

/* ---------------- Step 1: 内容规划 ---------------- */

const contentPlanningStep = createStep({
  id: WORKFLOW_STEP_IDS.contentPlanning,
  inputSchema: workflowInputSchema,
  outputSchema: pipelineContextSchema,
  execute: async ({ inputData, runId }) =>
    withStepEvents(runId, WORKFLOW_STEP_IDS.contentPlanning, async () => {
      const { input, executionContext } = inputData;
      const brand = executionContext.brandProfile;

      const { object } = await announcementPlannerAgent.generate(
        [
          `Announcement brief: ${input.brief}`,
          `Mode: ${input.mode}`,
          `Targets: ${JSON.stringify(input.targets)}`,
          `Brand profile: ${JSON.stringify(brand)}`,
          executionContext.priorApprovedExamples.length > 0
            ? `Prior approved examples (style reference):\n${executionContext.priorApprovedExamples.join('\n---\n')}`
            : 'No prior approved examples.',
        ].join('\n\n'),
        { structuredOutput: { schema: contentPlanSchema } },
      );

      const contentPlan = contentPlanSchema.parse(object);
      assertTargetsMatch(input.targets, contentPlan.perTarget, 'content plan');

      return {
        platformRunId: inputData.platformRunId,
        executionContext,
        targets: input.targets,
        contentPlan,
      };
    }),
});

/* ---------------- Step 2: 文案优化 ---------------- */

const copyOptimizationStep = createStep({
  id: WORKFLOW_STEP_IDS.copyOptimization,
  inputSchema: pipelineContextSchema,
  outputSchema: draftsPipelineSchema,
  execute: async ({ inputData, runId }) => {
    const emitter = getEmitter(runId);
    return withStepEvents(
      runId,
      WORKFLOW_STEP_IDS.copyOptimization,
      async () => {
        const { object } = await copyOptimizationAgent.generate(
          [
            `Content plan: ${JSON.stringify(inputData.contentPlan)}`,
            `Brand profile: ${JSON.stringify(inputData.executionContext.brandProfile)}`,
          ].join('\n\n'),
          { structuredOutput: { schema: draftSetSchema } },
        );

        const draftSet = draftSetSchema.parse(object);
        assertTargetsMatch(inputData.targets, draftSet.drafts, 'drafts');

        // §7 draft.created：run-service 据此更新 timeline / 展示草稿预览
        for (const draft of draftSet.drafts) {
          await emitter.emit('draft.created', {
            stepId: WORKFLOW_STEP_IDS.copyOptimization,
            platform: draft.platform,
            accountId: draft.accountId,
            contentPreview: draft.content.slice(0, 100),
            characterCount: draft.characterCount,
          });
        }

        return { ...inputData, drafts: draftSet.drafts };
      },
      (result) => ({ draftCount: result.drafts.length }),
    );
  },
});

/* ---------------- Step 3: 合规校验（确定性 + 语义） ---------------- */

const complianceCheckStep = createStep({
  id: WORKFLOW_STEP_IDS.complianceCheck,
  inputSchema: draftsPipelineSchema,
  outputSchema: compliancePipelineSchema,
  execute: async ({ inputData, runId }) =>
    withStepEvents(
      runId,
      WORKFLOW_STEP_IDS.complianceCheck,
      async () => {
        const brand = inputData.executionContext.brandProfile;

        // 1) 确定性校验：禁用词 / 平台长度上限 / 字数一致性
        const deterministicIssues = runDeterministicChecks(inputData.drafts, brand);

        // 2) 语义校验：语气漂移、夸大承诺、平台政策风险
        const { object } = await complianceCheckerAgent.generate(
          [
            `Drafts: ${JSON.stringify(inputData.drafts)}`,
            `Brand profile: ${JSON.stringify(brand)}`,
          ].join('\n\n'),
          { structuredOutput: { schema: complianceReportSchema } },
        );
        const semanticReport = complianceReportSchema.parse(object);

        const issues: ComplianceIssue[] = [...deterministicIssues, ...semanticReport.issues];
        const passed =
          semanticReport.passed && !issues.some((issue) => issue.severity === 'blocker');

        return { ...inputData, compliance: { passed, issues } };
      },
      (result) => ({
        passed: result.compliance.passed,
        issueCount: result.compliance.issues.length,
      }),
    ),
});

/* ---------------- Step 4: 构建多步骤 action plan ---------------- */

const buildActionPlanStep = createStep({
  id: WORKFLOW_STEP_IDS.buildActionPlan,
  inputSchema: compliancePipelineSchema,
  outputSchema: prepareAnnouncementResultSchema,
  execute: async ({ inputData, runId }) => {
    const emitter = getEmitter(runId);
    return withStepEvents(
      runId,
      WORKFLOW_STEP_IDS.buildActionPlan,
      async () => {
        const { platformRunId, executionContext } = inputData;
        const approvalRequired = resolveApprovalRequirement(executionContext);

        const actions: PlannedAction[] = inputData.drafts.map((draft, index) => ({
          stepOrder: index + 1,
          type: 'social.create_post',
          platform: draft.platform,
          accountId: draft.accountId,
          content: draft.content,
          hashtags: draft.hashtags,
          mode: 'publish_now',
          // §5.5 约定的幂等键格式
          idempotencyKey: `${platformRunId}:post:${draft.platform}:${draft.accountId}`,
          requiresApproval: approvalRequired,
        }));

        const actionPlan = actionPlanSchema.parse({
          summary: buildPlanSummary(actions, inputData.compliance),
          requiresApproval: approvalRequired,
          actions,
        });

        const result = prepareAnnouncementResultSchema.parse({
          contentPlan: inputData.contentPlan,
          drafts: inputData.drafts,
          compliance: inputData.compliance,
          actionPlan,
        });

        // §7 action_plan.created：run-service 据此创建 ApprovalRequest
        await emitter.emit('action_plan.created', {
          stepId: WORKFLOW_STEP_IDS.buildActionPlan,
          actionCount: actions.length,
          requiresApproval: approvalRequired,
          summary: actionPlan.summary,
        });

        return result;
      },
      (result) => ({ actionCount: result.actionPlan.actions.length }),
    );
  },
});

function buildPlanSummary(
  actions: PlannedAction[],
  compliance: { passed: boolean; issues: ComplianceIssue[] },
): string {
  const platforms = actions.map((a) => `${a.platform}(${a.accountId})`).join(', ');
  const blockers = compliance.issues.filter((i) => i.severity === 'blocker').length;
  const base = `Publish announcement to ${actions.length} target(s): ${platforms}.`;
  return blockers > 0
    ? `${base} WARNING: ${blockers} compliance blocker(s) must be resolved before publishing.`
    : base;
}

/* ---------------- Workflow 组装 ---------------- */

export const prepareAnnouncementWorkflow = createWorkflow({
  id: 'prepare-announcement-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: prepareAnnouncementResultSchema,
})
  .then(contentPlanningStep)
  .then(copyOptimizationStep)
  .then(complianceCheckStep)
  .then(buildActionPlanStep)
  .commit();
