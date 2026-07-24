import assert from 'node:assert/strict';
import test from 'node:test';

import { can, requirePermission } from './rbac';

test('RBAC never grants a viewer permission to run a workflow', () => {
  assert.equal(can('viewer', 'workflow:run'), false);
  assert.throws(() => requirePermission('viewer', 'workflow:run'), /Forbidden/);
  assert.equal(can('owner', 'connection:manage'), true);
});
