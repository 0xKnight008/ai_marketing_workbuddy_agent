import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActorContext } from '../contracts/domain';
import type { Database } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import type { PlatformOrm } from '../foundation/sequelize';
import { PlatformService } from './platform-service';

test('pending approvals use the tenant-scoped Sequelize repository', async () => {
  const actor: ActorContext = { actorId: 'actor-1', workspaceId: 'workspace-1', role: 'approver' };
  const expected = [{ id: 'approval-1', runId: 'run-1', requestedAction: {}, requestedAt: new Date() }];
  let receivedWorkspace: string | undefined;
  const orm = {
    async pendingApprovals(workspaceId: string) {
      receivedWorkspace = workspaceId;
      return expected;
    },
  } as unknown as PlatformOrm;
  const service = new PlatformService({} as GatewayConfig, {} as Database, orm);

  assert.deepEqual(await service.pendingApprovals(actor), expected);
  assert.equal(receivedWorkspace, actor.workspaceId);
});
