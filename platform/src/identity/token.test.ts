import assert from 'node:assert/strict';
import test from 'node:test';

import { issueAccessToken, verifyAccessToken } from './token';

test('access tokens are signed, scoped, and expire', () => {
  const secret = 'a'.repeat(32);
  const token = issueAccessToken({ actorId: 'user', workspaceId: 'workspace', role: 'editor', exp: 2_000_000_000 }, secret);
  assert.equal(verifyAccessToken(token, secret, 1_900_000_000).workspaceId, 'workspace');
  assert.throws(() => verifyAccessToken(token, `${secret}x`, 1_900_000_000), /Invalid/);
});
