import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';

import { announcementPlannerAgent } from '../agents/announcement-planner-agent';
import { complianceCheckerAgent } from '../agents/compliance-checker-agent';
import { copyOptimizationAgent } from '../agents/copy-optimization-agent';
import { config } from '../config';
import { internalApiRoutes } from '../internal-api/routes';
import { prepareAnnouncementWorkflow } from '../workflows/prepare-announcement-workflow';

/**
 * ai-runtime Mastra 实例（架构文档 §3.5）。
 *
 * 拥有：Mastra Server API、workflow definitions、agents、structured schemas。
 * 不拥有：组织记忆、平台用户数据、connector 凭证、外部副作用执行。
 *
 * 部署注意（§10）：
 * - 生产环境必须把 storage 换成共享 adapter（Postgres / Upstash），
 *   本地 LibSQL file 仅限开发。
 * - Mastra Studio 只指向 staging（§12.5），通过 MASTRA_STUDIO_ENABLED 控制。
 */
export const mastra = new Mastra({
  agents: {
    announcementPlannerAgent,
    copyOptimizationAgent,
    complianceCheckerAgent,
  },
  workflows: {
    prepareAnnouncementWorkflow,
  },
  storage: new LibSQLStore({
    id: 'ai-runtime-storage',
    url: config.storageUrl,
    authToken: config.storageAuthToken,
  }),
  logger: new PinoLogger({
    name: 'ai-runtime',
    level: 'info',
  }),
  server: {
    port: config.port,
    apiRoutes: internalApiRoutes,
  },
});
