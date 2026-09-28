import assert from 'node:assert/strict';
import type { Client } from 'pg';
import type { Database } from '../src/foundation/database';
import { PlatformService } from '../src/egg/platform-service';
import type { ActorContext } from '../src/contracts/domain';

export async function zernioDisconnectRegression(client: Client, database: Database): Promise<void> {
  const workspace = (await client.query("INSERT INTO workspace(name,slug) VALUES('Zernio disconnect','zernio-disconnect-test') RETURNING id")).rows[0].id;
  const other = (await client.query("INSERT INTO workspace(name,slug) VALUES('Other Zernio','zernio-disconnect-other') RETURNING id")).rows[0].id;
  await client.query("INSERT INTO zernio_tenant(workspace_id,profile_id) VALUES($1,'disconnect-profile')", [workspace]);
  const accounts = [{ externalId: 'external-account', platform: 'linkedin', displayName: 'Page', status: 'connected', capabilities: ['publish', 'schedule'] }];
  let fail = true; let deletes = 0;
  const service = Object.create(PlatformService.prototype) as PlatformService;
  Object.assign(service, { database, zernioClient: () => ({
    listAccounts: async () => accounts,
    disconnectAccount: async (id: string, scope: string) => { assert.equal(id, 'external-account'); assert.equal(scope, workspace); deletes++; if (fail) throw new Error('provider unavailable'); },
    select: async () => 'external-account',
  }), openZernioSelection: () => ({ context: { workspaceId: workspace, profileId: 'disconnect-profile', platform: 'linkedin' }, option: { id: 'native-id' } }) });
  const actor: ActorContext = { actorId: '11111111-1111-4111-8111-111111111111', workspaceId: workspace, role: 'owner' };
  await service.syncZernio(actor);
  const row = async () => (await client.query('SELECT * FROM connected_account WHERE workspace_id=$1', [workspace])).rows[0];
  const accountId = (await row()).id;
  assert.deepEqual((await row()).capabilities, ['publish', 'schedule'], 'JSONB receives a JSON array, not a PostgreSQL array literal');
  await assert.rejects(service.disconnectZernioAccount({ ...actor, role: 'editor' }, accountId), /Forbidden/);
  await assert.rejects(service.disconnectZernioAccount({ ...actor, workspaceId: other }, accountId), /not_found/);
  assert.equal(deletes, 0);
  await assert.rejects(service.disconnectZernioAccount(actor, accountId), /provider unavailable/);
  assert.equal((await row()).locally_disconnected, true);
  await service.syncZernio(actor); // delayed supplier list still includes the account
  assert.equal((await row()).status, 'disconnected');
  assert.deepEqual((await row()).capabilities, []);
  fail = false;
  await service.disconnectZernioAccount(actor, accountId);
  assert.equal(deletes, 2);
  assert.deepEqual(await service.selectZernioAccount('sealed'), { kind: 'connected' });
  assert.equal((await row()).locally_disconnected, false);
  assert.equal((await row()).status, 'connected');
  assert.deepEqual((await row()).capabilities, ['publish', 'schedule']);
}
