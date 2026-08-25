import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ZERNIO_CLIENT_RPM, SupplierUnavailableError, ZernioClient } from './client';

test('Zernio OAuth state is signed and workspace-bound', () => {
  const client = new ZernioClient({ baseUrl: 'https://zernio.example', oauthClientId: 'client', oauthRedirectUri: 'https://app.example/callback', oauthStateSecret: 'x'.repeat(32) });
  const url = new URL(client.connectUrl('workspace-a', 2_000_000_000));
  const state = url.searchParams.get('state');
  assert.ok(state);
  assert.equal(client.verifyState(state, 1_900_000_000).workspaceId, 'workspace-a');
  assert.throws(() => client.verifyState(`${state}x`, 1_900_000_000), /Invalid/);
});

test('uses a caller-configured shared request limit instead of a fixed plan tier', async () => {
  const client = new ZernioClient({
    baseUrl: 'https://zernio.example', oauthClientId: 'client', oauthRedirectUri: 'https://app.example/callback', oauthStateSecret: 'x'.repeat(32),
    globalRequestsPerMinute: 1, now: () => 1_000, fetchImpl: async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 }),
  });
  await client.listAccounts('token');
  await assert.rejects(() => client.listAccounts('token'), SupplierUnavailableError);
  assert.equal(DEFAULT_ZERNIO_CLIENT_RPM, 480);
});
