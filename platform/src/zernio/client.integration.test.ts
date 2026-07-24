import assert from 'node:assert/strict';
import test from 'node:test';

import { ZernioClient } from './client';

const baseUrl = process.env.ZERNIO_BASE_URL;
const accessToken = process.env.ZERNIO_ACCESS_TOKEN;

test('Zernio configured environment exposes a normalized account contract', { skip: !baseUrl || !accessToken }, async () => {
  const client = new ZernioClient({ baseUrl: baseUrl!, oauthClientId: 'contract-test', oauthRedirectUri: 'https://localhost/ignored', oauthStateSecret: 'x'.repeat(32) });
  const accounts = await client.listAccounts(accessToken!);
  for (const account of accounts) {
    assert.ok(account.externalId);
    assert.ok(account.displayName);
    assert.ok(Array.isArray(account.capabilities));
  }
});
