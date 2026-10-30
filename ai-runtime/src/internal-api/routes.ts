import { installMeteredFetch, meteredRequestMiddleware, readRuntimeRequestBody, runtimeCostContext } from '../lib/cost-metering';
installMeteredFetch();
import { requestTraceMiddleware, requestTraceContext, listRequestTraces, markTaskFailure } from '../lib/request-trace';
import { parseTaskOutput, taskJsonInstruction, TaskOutputError } from '../lib/task-output';
import {createTaskAgent,taskStepRequestSchema,taskStepResultSchema} from '../agents/task-agent';
import { registerApiRoute } from '@mastra/core/server';

import { createInsightReportAgent } from '../agents/insight-report-agent';
import { createItemClassifierAgent } from '../agents/item-classifier-agent';
import { createTopicAssignerAgent } from '../agents/topic-assigner-agent';
import { createTopicTaxonomyAgent } from '../agents/topic-taxonomy-agent';
import { config } from '../config';
import { modelForBand } from '../lib/model-routing';
import { structuredOutputForBand } from '../lib/structured-output';
import { classifyRequestSchema, classifyGenerationSchema } from '../schemas/classify';
import { insightReportRequestSchema, insightResultSchemas } from '../schemas/insights';
import { topicAssignRequestSchema, topicAssignResultSchema, topicProposeRequestSchema, topicProposeResultSchema } from '../schemas/topics';
import { RunServiceEventEmitter, registerEmitter, removeEmitter } from '../events/emitter';
import { prepareAnnouncementRequestSchema } from '../schemas/announcement';
import { internalAuth } from './auth';
import { listTokenUsage } from '../lib/token-ledger';
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
  registerApiRoute('/internal/task-step',{method:'POST',middleware:[internalAuth,requestTraceMiddleware,meteredRequestMiddleware],handler:async c=>{
    let body:unknown;try{body=await readRuntimeRequestBody(c)}catch{return c.json({error:'invalid_request'},400)}
    const parsed=taskStepRequestSchema.safeParse(body);if(!parsed.success)return c.json({error:'invalid_request',issues:parsed.error.issues},400);
    try {
      const request = parsed.data;
      const agent = createTaskAgent(modelForBand(config, request.modelBand, request.provider), request.taskId);
      const prompt = JSON.stringify({ goal: request.goal, language: request.language, history: request.history, priorResult: request.priorResult, sources: request.sources, steps: request.steps, remainingSteps: request.remainingSteps });
      const outputOptions = structuredOutputForBand(taskStepResultSchema, request.modelBand);
      const jsonMode = outputOptions.jsonPromptInjection === true;
      if (jsonMode) {
        // Parse this same response ourselves: preserve Markdown inside JSON and never issue a paid repair retry.
        const result = await agent.generate(taskJsonInstruction + '\nTask context:\n' + prompt);
        return c.json(parseTaskOutput(result.text, result.finishReason), 200);
      }
      const result = await agent.generate(prompt, { structuredOutput: outputOptions });
      return c.json(parseTaskOutput(JSON.stringify(result.object) ?? '', result.finishReason), 200);
    } catch (error) {
      const code = error instanceof TaskOutputError ? error.code : 'task_step_failed';
      if (!(error instanceof TaskOutputError)) markTaskFailure(code);
      return c.json({ error: code, requestId: requestTraceContext.getStore()?.requestId }, 502);
    }
  }}),
  registerApiRoute('/internal/request-traces', {
    method: 'GET', middleware: [internalAuth], handler: async c => {
      const id = c.req.query('id') ?? '';
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return c.json({ error: 'invalid_trace_id' }, 400);
      return c.json(await listRequestTraces(id));
    },
  }),
  registerApiRoute('/internal/token-usage', {
    method: 'GET', middleware: [internalAuth,requestTraceMiddleware,meteredRequestMiddleware],
    handler: async (c) => {
      const before = Number(c.req.query('before') ?? Number.MAX_SAFE_INTEGER);
      const q = c.req.query('q') ?? '';
      if (!Number.isSafeInteger(before) || before < 1 || q.length > 200) return c.json({ error: 'invalid_query' }, 400);
      return c.json(await listTokenUsage(before, q));
    },
  }),
  registerApiRoute('/internal/health', {
    method: 'GET',
    handler: async (c) => c.json({ ok: true, service: 'ai-runtime', meteringProtocol:'cost-v1', cacheWriteMetering: true, requestTimeoutMs: config.requestTimeoutMs, modelHttpTimeoutMs: config.modelHttpTimeoutMs }),
  }),

  registerApiRoute('/internal/ai-runs/prepare-announcement', {
    method: 'POST',
    middleware: [internalAuth,requestTraceMiddleware,meteredRequestMiddleware],
    handler: async (c) => {
      const mastra = c.get('mastra');
      const logger = mastra.getLogger();

      // 1. 校验 run-service 请求（§5.4 契约）
      let body: unknown;
      try {
        body = await readRuntimeRequestBody(c);
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
        request.workspaceId,
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
            const message = runtimeCostContext.getStore()?.guardError ?? outcome.error?.message ?? 'workflow failed';
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
          const message = runtimeCostContext.getStore()?.guardError ?? (err instanceof Error ? err.message : String(err));
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

  registerApiRoute('/internal/classify', {
    method: 'POST',
    middleware: [internalAuth,requestTraceMiddleware,meteredRequestMiddleware],
    handler: async (c) => {
      let body: unknown;
      try {
        body = await readRuntimeRequestBody(c);
      } catch {
        return c.json({ error: 'invalid_request', message: 'Request body must be valid JSON' }, 400);
      }
      const parsed = classifyRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
      }
      const { items, modelBand, provider, language } = parsed.data;
      try {
        const agent = createItemClassifierAgent(modelForBand(config, modelBand, provider));
        const { object } = await agent.generate(
          `Classify each of the following ${items.length} item(s)${language === 'auto' ? '' : ` (expected language: ${language})`}. Items as JSON:\n${JSON.stringify(items)}`,
          { structuredOutput: structuredOutputForBand(classifyGenerationSchema, modelBand) },
        );
        return c.json(object, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: 'classify_failed', message }, 502);
      }
    },
  }),

  registerApiRoute('/internal/topics/propose', {
    method: 'POST',
    middleware: [internalAuth,requestTraceMiddleware,meteredRequestMiddleware],
    handler: async (c) => {
      let body: unknown;
      try {
        body = await readRuntimeRequestBody(c);
      } catch {
        return c.json({ error: 'invalid_request', message: 'Request body must be valid JSON' }, 400);
      }
      const parsed = topicProposeRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
      }
      const { items, modelBand, provider, language } = parsed.data;
      try {
        const agent = createTopicTaxonomyAgent(modelForBand(config, modelBand, provider));
        const { object } = await agent.generate(
          `Propose a topic taxonomy from the following sample of ${items.length} feedback item(s)${language === 'auto' ? '' : ` (expected language: ${language})`}. Items as JSON:\n${JSON.stringify(items)}`,
          { structuredOutput: structuredOutputForBand(topicProposeResultSchema, modelBand) },
        );
        return c.json(object, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: 'topics_propose_failed', message }, 502);
      }
    },
  }),

  registerApiRoute('/internal/topics/assign', {
    method: 'POST',
    middleware: [internalAuth,requestTraceMiddleware,meteredRequestMiddleware],
    handler: async (c) => {
      let body: unknown;
      try {
        body = await readRuntimeRequestBody(c);
      } catch {
        return c.json({ error: 'invalid_request', message: 'Request body must be valid JSON' }, 400);
      }
      const parsed = topicAssignRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
      }
      const { items, taxonomy, modelBand, provider, language } = parsed.data;
      try {
        const agent = createTopicAssignerAgent(modelForBand(config, modelBand, provider));
        const { object } = await agent.generate(
          `Assign each of the following ${items.length} item(s) to 0-3 topics from the fixed taxonomy${language === 'auto' ? '' : ` (expected language: ${language})`}. Taxonomy as JSON:\n${JSON.stringify(taxonomy)}\nItems as JSON:\n${JSON.stringify(items)}`,
          { structuredOutput: structuredOutputForBand(topicAssignResultSchema, modelBand) },
        );
        return c.json(object, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: 'topics_assign_failed', message }, 502);
      }
    },
  }),

  registerApiRoute('/internal/insight-report', {
    method: 'POST',
    middleware: [internalAuth,requestTraceMiddleware,meteredRequestMiddleware],
    handler: async (c) => {
      let body: unknown;
      try {
        body = await readRuntimeRequestBody(c);
      } catch {
        return c.json({ error: 'invalid_request', message: 'Request body must be valid JSON' }, 400);
      }
      const parsed = insightReportRequestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
      }
      const request = parsed.data;
      try {
        const agent = createInsightReportAgent(request.template, modelForBand(config, request.modelBand, request.provider));
        const prompt = `Generate the ${request.template} insight report from this evidence pack. Output language: ${request.language === 'auto' ? 'match the majority source language' : request.language}. Preserve all citations verbatim in the source language. Evidence pack as JSON:\n${JSON.stringify({
          workspaceLabel: request.workspaceLabel,
          totals: request.totals,
          topItems: request.topItems,
          tagSamples: request.tagSamples,
          memberStats: request.memberStats,
          priorReports: request.priorReports,
        })}`;
        // 按模板分支选择强类型 schema（联合类型无法直接传给 structuredOutput）。
        let object: unknown;
        if (request.template === 'content_recap') {
          object = (await agent.generate(prompt, { structuredOutput: structuredOutputForBand(insightResultSchemas.content_recap, request.modelBand) })).object;
        } else if (request.template === 'comment_insights') {
          object = (await agent.generate(prompt, { structuredOutput: structuredOutputForBand(insightResultSchemas.comment_insights, request.modelBand) })).object;
        } else if (request.template === 'product_opportunities') {
          object = (await agent.generate(prompt, { structuredOutput: structuredOutputForBand(insightResultSchemas.product_opportunities, request.modelBand) })).object;
        } else if (request.template === 'review_attribution') {
          object = (await agent.generate(prompt, { structuredOutput: structuredOutputForBand(insightResultSchemas.review_attribution, request.modelBand) })).object;
        } else if (request.template === 'community_digest') {
          object = (await agent.generate(prompt, { structuredOutput: structuredOutputForBand(insightResultSchemas.community_digest, request.modelBand) })).object;
        } else {
          object = (await agent.generate(prompt, { structuredOutput: structuredOutputForBand(insightResultSchemas.daily_ops, request.modelBand) })).object;
        }
        return c.json(object as Record<string, unknown>, 200);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: 'insight_report_failed', message }, 502);
      }
    },
  }),

  registerApiRoute('/internal/ai-runs/:aiRunId', {
    method: 'GET',
    middleware: [internalAuth,requestTraceMiddleware,meteredRequestMiddleware],
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
