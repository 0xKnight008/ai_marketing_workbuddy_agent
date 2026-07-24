import assert from 'node:assert/strict';
import test from 'node:test';
import { ZernioClient } from './client';

test('Zernio OAuth state is signed and workspace-bound', () => {
  const client = new ZernioClient({ baseUrl: 'https://zernio.example', oauthClientId: 'client', oauthRedirectUri: 'https://app.example/callback', oauthStateSecret: 'x'.repeat(32) });
  const url = new URL(client.connectUrl('workspace-a', 2_000_000_000));
  const state = url.searchParams.get('state');
  assert.ok(state);
  assert.equal(client.verifyState(state, 1_900_000_000).workspaceId, 'workspace-a');
  assert.throws(() => client.verifyState(`${state}x`, 1_900_000_000), /Invalid/);
});
