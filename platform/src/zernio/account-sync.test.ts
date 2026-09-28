import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformService } from '../egg/platform-service';
import type { TenantTransaction } from '../foundation/database';
import { assertExecutableAction } from '../connector-service/actions';
import type { ZernioAccount } from './client';

test('sync persists verified health states and clears stale capabilities in the tenant transaction', async () => {
  const accounts: ZernioAccount[] = ['connected', 'expired', 'disconnected', 'syncing'].map((status, i) => ({
    externalId: `account-${i}`, displayName: `Page ${i}`, platform: 'linkedin',
    status: status as ZernioAccount['status'], capabilities: status === 'connected' ? ['publish', 'schedule'] : [],
  }));
  const writes: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const service = Object.create(PlatformService.prototype) as PlatformService;
  Object.assign(service, {
    zernioProfile: async () => 'profile',
    zernioClient: () => ({ listAccounts: async (profile: string, workspace: string) => {
      assert.equal(profile, 'profile'); assert.equal(workspace, 'workspace'); return accounts;
    } }),
    database: { withWorkspace: async (workspace: string, operation: (tx: TenantTransaction) => Promise<unknown>) => {
      assert.equal(workspace, 'workspace');
      return operation({ query: async (sql, values) => { writes.push({ sql, values }); return { rows: [], rowCount: 1 }; } });
    } },
  });
  assert.deepEqual(await service.syncZernio({ workspaceId: 'workspace', actorId: 'actor', role: 'owner' }), { synced: 4 });
  for (const [i, account] of accounts.entries()) {
    assert.equal(writes[i]?.values?.[6], account.status);
    assert.deepEqual(JSON.parse(String(writes[i]?.values?.[3])), account.capabilities);
    assert.match(writes[i]!.sql, /ELSE EXCLUDED.status END/);
    assert.match(writes[i]!.sql, /locally_disconnected/);
    assert.equal(writes[i]?.values?.[7], null);
  }
  assert.match(writes[4]!.sql, /status = 'disconnected'/);
  for (const account of accounts) {
    const invoke = () => assertExecutableAction({ workspaceId: 'workspace', runId: 'run', stepId: 'step', attempt: 1,
      account: { id: account.externalId, workspaceId: 'workspace', status: account.status, capabilities: account.capabilities },
      type: 'social.create_post', payload: {} });
    if (account.status === 'connected') assert.doesNotThrow(invoke);
    else assert.throws(invoke, /not available/);
  }
});
