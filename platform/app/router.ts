import type { Application } from 'egg';

export default (app: Application) => {
  const { router, controller } = app;
  router.get('/internal/health', controller.platform.health);
  router.post('/internal/ai-runtime-events', controller.platform.runtimeEvent);
  router.post('/api/workflow-runs', controller.platform.createRun);
  router.post('/api/workflow-templates/:templateId/publish', controller.platform.publishTemplate);
  router.get('/api/zernio/connect', controller.platform.connectZernio);
  router.get('/api/zernio/callback', controller.platform.zernioCallback);
  router.post('/api/zernio/sync', controller.platform.syncZernio);
  router.get('/api/approval-requests', controller.platform.approvals);
  router.get('/api/runs/:runId', controller.platform.run);
  router.post('/api/approval-requests/:approvalId/:decision', controller.platform.decideApproval);
  router.get('/api/billing/task-events', controller.platform.taskEvents);
  router.get('/api/audit-events', controller.platform.auditEvents);
};
