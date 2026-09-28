import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformService } from '../egg/platform-service';
import { pendingConnectionPage } from './connection-pages';

function fixture(snapshots: unknown[][], selectedId: string | undefined = 'selected', mapped = 'profile') {
  const service = Object.create(PlatformService.prototype) as PlatformService;
  let selections = 0; let reads = 0; let writes = 0;
  Object.assign(service, {
    openZernioSelection: () => ({ context: { workspaceId: 'workspace', profileId: 'profile', platform: 'facebook' }, option: { id: 'native-page' } }),
    zernioProfile: async () => mapped,
    zernioClient: () => ({ select: async () => { selections++; return selectedId; }, listAccounts: async () => snapshots[Math.min(reads++, snapshots.length - 1)] }),
    storeZernioAccounts: async () => { writes++; },
  });
  return { service, counts: () => ({ selections, reads, writes }) };
}
const selected = { externalId: 'selected', platform: 'facebook', status: 'connected' };

test('zero, wrong-target, wrong-platform and unknown-ID selections never report success', async () => {
  for (const rows of [[], [{ ...selected, externalId: 'old' }], [{ ...selected, platform: 'linkedin' }]]) {
    const f = fixture([rows]);
    assert.deepEqual(await f.service.selectZernioAccount('sealed'), { kind: 'pending' });
    assert.deepEqual(f.counts(), { selections: 1, reads: 3, writes: 0 });
  }
  const f = fixture([[selected]], undefined);
  // Explicitly override the default argument for the missing-ID response.
  Object.assign(f.service, { zernioClient: () => ({ select: async () => undefined }) });
  assert.deepEqual(await f.service.selectZernioAccount('sealed'), { kind: 'pending' });
  assert.equal(f.counts().writes, 0);
});

test('eventual account visibility polls GET only and verifies account health', async () => {
  const f = fixture([[], [selected]]);
  assert.deepEqual(await f.service.selectZernioAccount('sealed'), { kind: 'connected' });
  assert.deepEqual(f.counts(), { selections: 1, reads: 2, writes: 1 });
  for (const status of ['syncing', 'expired', 'disconnected']) {
    const unhealthy = fixture([[{ ...selected, status }]]);
    assert.deepEqual(await unhealthy.service.selectZernioAccount('sealed'), { kind: 'pending' });
    assert.equal(unhealthy.counts().writes, 1);
  }
});

test('tenant mismatch prevents provider selection; pending HTML never emits success event', async () => {
  const f = fixture([[selected]], 'selected', 'foreign');
  await assert.rejects(f.service.selectZernioAccount('sealed'), /tenant_mismatch/);
  assert.equal(f.counts().selections, 0);
  assert.doesNotMatch(pendingConnectionPage(), /postMessage|zernio-connected|<script/);
  assert.match(pendingConnectionPage(), /Sync account health/);
});
