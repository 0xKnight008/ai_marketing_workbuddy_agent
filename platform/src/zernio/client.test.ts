import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ZERNIO_CLIENT_RPM, SupplierUnavailableError, ZernioClient } from './client';

function client(fetchImpl: typeof fetch = fetch) {
  return new ZernioClient({
    baseUrl: 'https://zernio.example/api',
    apiKey: 'team-api-key',
    oauthRedirectUri: 'https://app.example/api/zernio/callback',
    oauthStateSecret: 'x'.repeat(32),
    fetchImpl,
  });
}

test('Zernio state is signed and binds workspace, profile, and platform', () => {
  const provider = client();
  const state = provider.createState('workspace-a', 'profile-a', 'facebook', 2_000_000_000);
  assert.deepEqual(provider.verifyState(state, 1_900_000_000), { workspaceId: 'workspace-a', profileId: 'profile-a', platform: 'facebook' });
  assert.throws(() => provider.verifyState(`${state}x`, 1_900_000_000), /Invalid/);
});

test('connect initialization uses the tenant profile and mandatory headless mode', async () => {
  let received: Request | URL | string | undefined;
  const provider = client(async (input) => {
    received = input;
    return new Response(JSON.stringify({ authUrl: 'https://social.example/oauth' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await provider.connectUrl('workspace-a', 'profile-a', 'facebook');
  assert.equal(result, 'https://social.example/oauth');
  const url = new URL(String(received));
  assert.equal(url.pathname, '/api/v1/connect/facebook');
  assert.equal(url.searchParams.get('profileId'), 'profile-a');
  assert.equal(url.searchParams.get('headless'), 'true');
  const redirect = new URL(url.searchParams.get('redirect_url')!);
  const state = provider.verifyState(redirect.searchParams.get('state')!);
  assert.deepEqual(state, { workspaceId: 'workspace-a', profileId: 'profile-a', platform: 'facebook' });
});

test('account sync always sends profileId and normalizes current Zernio account fields', async () => {
  let authorization: string | null = null;
  let received: Request | URL | string | undefined;
  const provider = client(async (input, init) => {
    received = input;
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ accounts: [{ _id: 'account-a', displayName: 'Main Page', platform: 'facebook' }] }), { status: 200 });
  });
  assert.deepEqual(await provider.listAccounts('profile-a', 'workspace-a'), [{ externalId: 'account-a', displayName: 'Main Page', capabilities: [], platform: 'facebook' }]);
  assert.equal(new URL(String(received)).searchParams.get('profileId'), 'profile-a');
  assert.equal(authorization, 'Bearer team-api-key');
});

test('headless callbacks accept Zernio step spelling variants', () => {
  const parsed = client().parseHeadlessCallback({ platform: 'whatsapp', profileId: 'profile-a', step: 'selectphonenumber', tempToken: 'temporary', connect_token: 'connect' });
  assert.equal(parsed?.step, 'select_phone_number');
  assert.equal(parsed?.connectToken, 'connect');
});

test('WhatsApp headless selection keeps the connect token server-side and posts the tenant identifiers', async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const provider = client(async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    return calls.length === 1
      ? new Response(JSON.stringify({ phoneNumbers: [{ id: 'phone-a', verified_name: 'Support', wabaId: 'waba-a' }] }), { status: 200 })
      : new Response(JSON.stringify({ account: { accountId: 'account-a' } }), { status: 200 });
  });
  const context = {
    workspaceId: 'workspace-a', profileId: 'profile-a', platform: 'whatsapp' as const,
    step: 'select_phone_number' as const, tempToken: 'temporary', connectToken: 'connect-secret', expiresAt: 2_000_000_000,
  };
  const selection = await provider.listSelections(context);
  assert.equal(selection.options[0]?.label, 'Support');
  await provider.select(selection.context, selection.options[0]!);
  assert.equal(calls[0]?.url.searchParams.get('profileId'), 'profile-a');
  assert.equal(new Headers(calls[0]?.init?.headers).get('x-connect-token'), 'connect-secret');
  const body = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual({ profileId: body.profileId, phoneNumberId: body.phoneNumberId, wabaId: body.wabaId }, { profileId: 'profile-a', phoneNumberId: 'phone-a', wabaId: 'waba-a' });
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
