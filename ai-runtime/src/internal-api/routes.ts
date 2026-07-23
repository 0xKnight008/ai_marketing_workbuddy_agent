import { registerApiRoute } from '@mastra/core/server';

import { RunServiceEventEmitter, registerEmitter, removeEmitter } from '../events/emitter';
import { prepareAnnouncementRequestSchema } from '../schemas/announcement';
import { internalAuth } from './auth';
import { createAiRunRecord, getAiRunRecord, updateAiRunRecord } from './run-registry';

/**
 * ai-runtime 内部 API（架构文档 §5.4）。
 *
 * run-service 只感知这里的业务友好 route，不直接调用 Mastra 原生
 * /api/workflows/{workflowId}/start-async（MVP 阶段 §12.1 虽然允许直连原生
 * route，但本实现从第一天就收敛到业务 route，原生 route 仅留给 staging 的
 * Mastra Studio 调试）。
 */
export const internalApiRoutes = [
  registerApiRoute('/internal/health', {
    method: 'GET',
    handler: async (c) => c.json({ ok: true, service: 'ai-runtime' }),
  }),

  registerApiRoute('/internal/ai-runs/prepare-announcement', {
    method: 'POST',
    middleware: [internalAuth],
    handler: async (c) => {
      const mastra = c.get('mastra');
      const logger = mastra.getLogger();

      // 1. 校验 run-service 请求（§5.4 契约）
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid_request', message: 'Request body must be valid JSON' }, 400);
      }

      const parsed = prepareAnnouncementRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: 'invalid_request', issues: parsed.error.issues },
          400,
        );
      }
      const request = parsed.data;

      // 2. 创建 Mastra workflow run（aiRunId = Mastra run id，
      //    run-service 侧应保存到 AIRuntimeRunMapping）
      const workflow = mastra.getWorkflow('prepareAnnouncementWorkflow');
      const run = await workflow.createRun();
      const aiRunId = run.runId;

      // 3. 注册事件 emitter 与业务态记录
      const emitter = new RunServiceEventEmitter(
        request.platformRunId,
        aiRunId,
      );
      registerEmitter(aiRunId, emitter);
      try {
        await createAiRunRecord({
          aiRunId,
          platformRunId: request.platformRunId,
          workspaceId: request.workspaceId,
          actorId: request.actorId,
        });
      } catch (error) {
        removeEmitter(aiRunId);
        throw error;
      }

      // 4. 异步执行 workflow；生命周期事件走 emitter 回报 run-service。
      //    调用方同步拿到 202 + aiRunId，用轮询或事件回调获取最终结果。
      void (async () => {
        try {
          await updateAiRunRecord(aiRunId, { status: 'running' });
          await emitter.emit('ai_run.started', {
            workflowId: 'prepare-announcement-workflow',
            mode: request.input.mode,
            targetCount: request.input.targets.length,
          });
          const outcome = await run.start({
            inputData: {
              platformRunId: request.platformRunId,
              workspaceId: request.workspaceId,
              actorId: request.actorId,
              input: request.input,
              executionContext: request.executionContext,
            },
          });

          if (outcome.status === 'success') {
            await updateAiRunRecord(aiRunId, {
              status: 'succeeded',
              result: outcome.result,
              finishedAt: new Date().toISOString(),
            });
            await emitter.emit('ai_run.succeeded', {
              actionCount: outcome.result.actionPlan.actions.length,
              requiresApproval: outcome.result.actionPlan.requiresApproval,
              compliancePassed: outcome.result.compliance.passed,
            });
          } else if (outcome.status === 'failed') {
            const message = outcome.error?.message ?? 'workflow failed';
            await updateAiRunRecord(aiRunId, {
              status: 'failed',
              error: message,
              finishedAt: new Date().toISOString(),
            });
            await emitter.emit('ai_run.failed', { error: message });
          } else {
            // suspended：当前 workflow 无 suspend step，防御性处理
            logger?.warn(`workflow run ${aiRunId} suspended unexpectedly`);
            await updateAiRunRecord(aiRunId, {
              status: 'failed',
              error: `unexpected workflow status: ${outcome.status}`,
              finishedAt: new Date().toISOString(),
            });
            await emitter.emit('ai_run.failed', {
              error: `unexpected workflow status: ${outcome.status}`,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger?.error(`workflow run ${aiRunId} crashed: ${message}`);
          await updateAiRunRecord(aiRunId, {
            status: 'failed',
            error: message,
            finishedAt: new Date().toISOString(),
          });
          await emitter.emit('ai_run.failed', { error: message });
        } finally {
          removeEmitter(aiRunId);
        }
      })();

      // §4.1：accepted { aiRunId }
      return c.json({ aiRunId, status: 'accepted' }, 202);
    },
  }),

  registerApiRoute('/internal/ai-runs/:aiRunId', {
    method: 'GET',
    middleware: [internalAuth],
    handler: async (c) => {
      const aiRunId = c.req.param('aiRunId');
      const record = await getAiRunRecord(aiRunId);
      if (!record) {
        return c.json({ error: 'ai_run_not_found', aiRunId }, 404);
      }
      // succeeded 时携带完整结构化结果（drafts / compliance / actionPlan），
      // run-service 校验 action plan 后进入审批流（§12.2）。
      return c.json(record, 200);
    },
  }),
];
