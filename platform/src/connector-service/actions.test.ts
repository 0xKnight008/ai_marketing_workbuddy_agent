import assert from 'node:assert/strict';
import test from 'node:test';

import { actionIdempotencyKey, assertExecutableAction, type ConnectorActionRequest } from './actions';

const action: ConnectorActionRequest = {
  workspaceId: 'workspace-a', runId: 'run-a', stepId: 'post-1', attempt: 1,
  account: { id: 'account-a', workspaceId: 'workspace-a', status: 'connected', capabilities: ['publish', 'schedule'] },
  type: 'social.create_post', payload: { content: 'Hello' },
};

test('connector actions are workspace-scoped and idempotent', () => {
  assert.doesNotThrow(() => assertExecutableAction(action));
  assert.equal(actionIdempotencyKey(action), actionIdempotencyKey(action));
  assert.throws(() => assertExecutableAction({ ...action, workspaceId: 'workspace-b' }), /outside this workspace/);
});
