import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkflowRun } from './run-request';

const validRequest = {
  workflowId: '46b3e3e8-62a2-4d3d-b715-f4b95dc497fd',
  workflowVersion: 1,
  idempotencyKey: 'request-idempotency-123',
  input: { brief: 'Launch update' },
  context: { tone: 'clear', language: 'en', forbiddenWords: [], approvalPolicy: 'required', allowedModelClasses: ['standard'] },
};

test('gateway rejects a viewer before calling run-service', async () => {
  let invoked = false;
  await assert.rejects(
    createWorkflowRun(
      { actorId: 'actor', workspaceId: 'workspace', role: 'viewer' },
      validRequest,
      { createRun: async () => { invoked = true; return { runId: 'run', status: 'pending' as const }; } },
    ),
    /Forbidden/,
  );
  assert.equal(invoked, false);
});
