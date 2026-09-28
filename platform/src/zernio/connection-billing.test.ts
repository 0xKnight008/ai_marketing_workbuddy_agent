import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformService } from '../egg/platform-service';
import { ZernioClient } from './client';
import { publicError } from '../http/errors';
import type { ActorContext } from '../contracts/domain';

const actor: ActorContext = { actorId: 'user', workspaceId: 'workspace', role: 'owner' };
function fixture(status = 200) {
  let calls = 0;
  const provider = new ZernioClient({ baseUrl: 'https://zernio.example/api', apiKey: 'test',
    oauthRedirectUri: 'https://app.example/api/zernio/callback', oauthStateSecret: 's'.repeat(32),
    fetchImpl: async (input) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/v1/connect/twitter');
      assert.equal(url.searchParams.get('profileId'), 'profile');
      return status === 200 ? Response.json({ authUrl: 'https://x.com/oauth/authorize' })
        : Response.json({ reason: 'twitter_passthrough', error: 'private provider detail' }, { status });
    } });
  const service = Object.create(PlatformService.prototype) as PlatformService;
  Object.assign(service, { database: { withWorkspace: async (_id: string, op: (tx: unknown) => unknown) => op({
    query: async (sql: string) => {
      assert.match(sql, /SELECT profile_id/);
      assert.doesNotMatch(sql, /workspace_billing|task_event|purchased_ai_credits/);
      return { rows: [{ profileId: 'profile' }] };
    },
  }) }, zernioClient: () => provider });
  return { service, calls: () => calls };
}
test('X OAuth does not read or charge credits, even without a billing row', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.startZernioConnection(actor, 'twitter'), { url: 'https://x.com/oauth/authorize' });
  assert.equal(f.calls(), 1);
});
test('provider connection 402 is explicit, not a customer credit error or fake OAuth success', async () => {
  const f = fixture(402);
  await assert.rejects(f.service.startZernioConnection(actor, 'twitter'), error => {
    const result = publicError(error);
    assert.equal(result.statusCode, 402);
    assert.equal(result.body.error, 'zernio_connection_billing_restricted');
    assert.match(result.body.message!, /provider-side/);
    assert.doesNotMatch(JSON.stringify(result), /private provider detail/);
    return true;
  });
  assert.equal(f.calls(), 1);
});
test('connection still requires owner/admin permission before provider calls', async () => {
  const f = fixture();
  await assert.rejects(f.service.startZernioConnection({ ...actor, role: 'viewer' }, 'twitter'), /Forbidden/);
  assert.equal(f.calls(), 0);
});
