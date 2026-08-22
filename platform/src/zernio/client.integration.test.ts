import assert from 'node:assert/strict';
import test from 'node:test';

import { ZernioClient } from './client';

const baseUrl = process.env.ZERNIO_BASE_URL;
const apiKey = process.env.ZERNIO_API_KEY;
const profileId = process.env.ZERNIO_PROFILE_ID;

test('Zernio configured environment exposes a profile-scoped normalized account contract', { skip: !baseUrl || !apiKey || !profileId }, async () => {
  const client = new ZernioClient({ baseUrl: baseUrl!, apiKey: apiKey!, oauthRedirectUri: 'https://localhost/ignored', oauthStateSecret: 'x'.repeat(32) });
  const accounts = await client.listAccounts(profileId!);
  for (const account of accounts) {
    assert.ok(account.externalId);
    assert.ok(account.displayName);
    assert.ok(Array.isArray(account.capabilities));
  }
});
