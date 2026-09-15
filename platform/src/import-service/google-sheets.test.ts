import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpError } from '../http/errors';
import {
  assertGoogleSheetsConfigured, createGoogleOAuthState, exchangeGoogleCode, googleAuthorizeUrl,
  readGoogleSheetValues, refreshGoogleAccessToken, sheetRowsToItems, verifyGoogleOAuthState,
  type GoogleSheetsConfig,
} from './google-sheets';

const config: GoogleSheetsConfig = {
  GOOGLE_SHEETS_CLIENT_ID: 'client-id',
  GOOGLE_SHEETS_CLIENT_SECRET: 'client-secret',
  GOOGLE_SHEETS_OAUTH_REDIRECT_URI: 'https://gateway.example.com/api/imports/google/callback',
  SECRET_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
};
const secret = 'test-only-state-secret-padding-32';
const sheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';

test('configuration requires client credentials, redirect URI and the encryption key', () => {
  assert.throws(() => assertGoogleSheetsConfigured({}), (error) => error instanceof HttpError && error.code === 'google_sheets_not_configured');
  assert.throws(() => assertGoogleSheetsConfigured({ ...config, SECRET_ENCRYPTION_KEY_BASE64: undefined }),
    (error) => error instanceof HttpError && error.code === 'google_sheets_encryption_not_configured');
  assert.doesNotThrow(() => assertGoogleSheetsConfigured(config));
});

test('OAuth state round-trips and rejects tampering and expiry', () => {
  const state = createGoogleOAuthState(secret, 'workspace-1', 'user-1');
  assert.deepEqual(verifyGoogleOAuthState(secret, state), { workspaceId: 'workspace-1', actorId: 'user-1' });
  assert.throws(() => verifyGoogleOAuthState(secret, `${state}x`), (error) => error instanceof HttpError && error.code === 'google_oauth_state_invalid');
  assert.throws(() => verifyGoogleOAuthState('other-secret-other-secret-other-32', state), (error) => error instanceof HttpError && error.code === 'google_oauth_state_invalid');
  const expired = createGoogleOAuthState(secret, 'workspace-1', 'user-1', Math.floor(Date.now() / 1000) - 1);
  assert.throws(() => verifyGoogleOAuthState(secret, expired), (error) => error instanceof HttpError && error.code === 'google_oauth_state_expired');
});

test('authorize URL requests offline access, consent and the readonly scope', () => {
  const url = new URL(googleAuthorizeUrl(config, 'state-1'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.ok(url.searchParams.get('scope')!.includes('spreadsheets.readonly'));
  assert.equal(url.searchParams.get('redirect_uri'), config.GOOGLE_SHEETS_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get('state'), 'state-1');
});

function idToken(email: string): string {
  return `h.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.s`;
}

test('code exchange returns the refresh token and verified-channel email', async () => {
  const result = await exchangeGoogleCode(config, 'code-1', async () => new Response(JSON.stringify({
    access_token: 'a', refresh_token: 'r', scope: 'openid email sheets', id_token: idToken('owner@example.com'),
  })));
  assert.deepEqual(result, { refreshToken: 'r', email: 'owner@example.com', scopes: ['openid', 'email', 'sheets'] });
});

test('code exchange without a refresh token fails loudly', async () => {
  await assert.rejects(
    exchangeGoogleCode(config, 'code-1', async () => new Response(JSON.stringify({ access_token: 'a', id_token: idToken('a@b.c') }))),
    (error) => error instanceof HttpError && error.code === 'google_oauth_missing_refresh_token',
  );
  await assert.rejects(
    exchangeGoogleCode(config, 'bad', async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    (error) => error instanceof HttpError && error.code === 'google_oauth_code_rejected',
  );
});

test('refresh maps invalid_grant to a reconnect signal', async () => {
  const token = await refreshGoogleAccessToken(config, 'r', async () => new Response(JSON.stringify({ access_token: 'fresh' })));
  assert.equal(token, 'fresh');
  await assert.rejects(
    refreshGoogleAccessToken(config, 'r', async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })),
    (error) => error instanceof HttpError && error.code === 'google_sheets_connection_revoked',
  );
});

test('sheet reads map provider failures to actionable errors', async () => {
  const read = (status: number, body = '{}') => readGoogleSheetValues('token', sheetId, undefined, async () => new Response(body, { status }));
  await assert.rejects(read(401), (error) => error instanceof HttpError && error.code === 'google_sheets_connection_revoked');
  await assert.rejects(read(403), (error) => error instanceof HttpError && error.code === 'google_sheets_check_spreadsheet_sharing');
  await assert.rejects(read(429), (error) => error instanceof HttpError && error.code === 'google_sheets_rate_limited_retry_later');
  await assert.rejects(read(500), (error) => error instanceof HttpError && error.code === 'google_sheets_provider_unavailable');
  assert.deepEqual(await read(200, JSON.stringify({ values: [['text'], ['hello']] })), [['text'], ['hello']]);
  assert.deepEqual(await read(200, JSON.stringify({})), []);
});

test('sheet rows reuse the CSV field mapping and dedup on content hash', () => {
  const rows = [
    ['text', 'author', 'platform', 'likes', 'rating', ''],
    ['Love the new serum', 'amy', 'X', '12', '5', 'ignored'],
    ['Love the new serum', 'amy', 'X', '12', '5', ''],       // duplicate row
    ['  Love the new   serum  ', 'amy', 'x', '9', '5', ''],  // whitespace variant
    ['The packaging leaks', 'ben', 'rednote', '3', '1', ''],
    ['', 'nobody', 'x', '0', '', ''],                        // no text → skipped
  ];
  const items = sheetRowsToItems(rows, sheetId);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.platform, 'twitter');
  assert.equal(items[0]!.author, 'amy');
  assert.equal(items[0]!.metrics.likes, 12);
  assert.equal(items[0]!.metrics.spreadsheetId, sheetId);
  assert.ok(items[0]!.externalId!.startsWith('gsheets:'));
  assert.equal(items[1]!.platform, 'rednote');
  assert.equal(items[1]!.metrics.rating, 1);
});

test('sheets without a usable header row produce no items', () => {
  assert.deepEqual(sheetRowsToItems([], sheetId), []);
  assert.deepEqual(sheetRowsToItems([['text']], sheetId), []);
  assert.deepEqual(sheetRowsToItems([['unrelated', 'columns'], ['a', 'b']], sheetId), []);
});
