import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { decryptSecret, encryptSecret } from './secrets';

test('secrets are encrypted with authenticated encryption', () => {
  const key = randomBytes(32).toString('base64');
  const encrypted = encryptSecret('oauth-refresh-token', key);
  assert.notEqual(encrypted.ciphertext, 'oauth-refresh-token');
  assert.equal(decryptSecret(encrypted, key), 'oauth-refresh-token');
});
