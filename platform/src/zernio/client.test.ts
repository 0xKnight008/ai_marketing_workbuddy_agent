import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ZERNIO_CLIENT_RPM, SupplierUnavailableError, ZernioClient } from './client';
import { publicError } from '../http/errors';

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
  const state = provider.createState('11111111-1111-4111-8111-111111111111', 'profile-a', 'facebook', 2_000_000_000);
  assert.deepEqual(provider.verifyState(state, 1_900_000_000), { workspaceId: '11111111-1111-4111-8111-111111111111', profileId: 'profile-a', platform: 'facebook' });
  assert.throws(() => provider.verifyState(`${state}x`, 1_900_000_000), /Invalid/);
});

test('X billing gate is actionable and does not expose supplier response content', async () => {
  const provider = client(async () => Response.json({ reason: 'twitter_passthrough', error: 'private provider detail' }, { status: 402 }));
  await assert.rejects(provider.connectUrl('11111111-1111-4111-8111-111111111111', 'profile-a', 'twitter'), error => {
    assert.deepEqual(publicError(error), { statusCode: 402, body: { error: 'zernio_x_billing_required' } }); return true;
  });
});
test('new OAuth platforms use the provider-hosted selection flow with signed tenant state', async () => {
  for (const platform of ['twitter', 'threads', 'reddit', 'bluesky', 'discord', 'slack'] as const) {
    const provider = client(async input => {
      const url = new URL(String(input));
      assert.equal(url.pathname, `/api/v1/connect/${platform}`);
      assert.equal(url.searchParams.get('headless'), 'false');
      assert.equal(url.searchParams.get('profileId'), 'profile-a');
      return Response.json({ authUrl: 'https://social.example/connect' });
    });
    await provider.connectUrl('11111111-1111-4111-8111-111111111111', 'profile-a', platform);
  }
});
test('Telegram uses its access-code API rather than expecting an OAuth URL', async () => {
  const provider = client(async input => {
    const url = new URL(String(input)); assert.equal(url.pathname, '/api/v1/connect/telegram'); assert.equal(url.searchParams.get('profileId'), 'profile-a');
    return Response.json({ code: 'ZRN-TEST', expiresAt: '2026-10-01T00:00:00Z', instructions: ['Add the bot as admin'], privateToken: 'not-for-browser' });
  });
  assert.deepEqual(await provider.telegramCode('11111111-1111-4111-8111-111111111111', 'profile-a'), { code: 'ZRN-TEST', expiresAt: '2026-10-01T00:00:00Z', instructions: ['Add the bot as admin'] });
});

test('connect initialization uses the tenant profile and mandatory headless mode', async () => {
  let received: Request | URL | string | undefined;
  const provider = client(async (input) => {
    received = input;
    return new Response(JSON.stringify({ authUrl: 'https://social.example/oauth' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await provider.connectUrl('11111111-1111-4111-8111-111111111111', 'profile-a', 'facebook');
  assert.equal(result, 'https://social.example/oauth');
  const url = new URL(String(received));
  assert.equal(url.pathname, '/api/v1/connect/facebook');
  assert.equal(url.searchParams.get('profileId'), 'profile-a');
  assert.equal(url.searchParams.get('headless'), 'true');
  const redirect = new URL(url.searchParams.get('redirect_url')!);
  const state = provider.verifyState(redirect.searchParams.get('state')!);
  assert.deepEqual(state, { workspaceId: '11111111-1111-4111-8111-111111111111', profileId: 'profile-a', platform: 'facebook' });
});

test('account sync always sends profileId and normalizes current Zernio account fields', async () => {
  let authorization: string | null = null;
  let received: Request | URL | string | undefined;
  const provider = client(async (input, init) => {
    if (String(input).endsWith('/account-a/health')) return Response.json({ accountId: 'account-a', status: 'healthy', tokenStatus: { valid: true }, permissions: { canPost: true, canFetchAnalytics: true } });
    received = input;
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ accounts: [{ _id: 'account-a', displayName: 'Main Page', platform: 'facebook' }] }), { status: 200 });
  });
  assert.deepEqual(await provider.listAccounts('profile-a', '11111111-1111-4111-8111-111111111111'), [{ externalId: 'account-a', displayName: 'Main Page', capabilities: ['publish', 'schedule', 'analytics'], status: 'connected', platform: 'facebook' }]);
  assert.equal(new URL(String(received)).searchParams.get('profileId'), 'profile-a');
  assert.equal(authorization, 'Bearer team-api-key');
});

test('disconnect uses the provider account ID and treats an absent account as already disconnected', async () => {
  for (const status of [200, 404]) {
    await client(async (input, init) => {
      assert.equal(String(input), 'https://zernio.example/api/v1/accounts/provider%2Faccount');
      assert.equal(init?.method, 'DELETE');
      return Response.json({}, { status });
    }).disconnectAccount('provider/account', 'workspace');
  }
  await assert.rejects(client(async () => Response.json({}, { status: 403 })).disconnectAccount('account', 'workspace'), SupplierUnavailableError);
});

test('revoked and disabled accounts never regain connected status or supplier-supplied capabilities', async () => {
  const provider = client(async input => {
    assert.ok(!String(input).endsWith('/health'));
    return Response.json({ accounts: [
      { _id: 'revoked', displayName: 'Revoked', needsReconnection: true, capabilities: ['publish'] },
      { _id: 'disabled', displayName: 'Disabled', enabled: false },
      { _id: 'inactive', displayName: 'Inactive', isActive: false },
    ] });
  });
  const accounts = await provider.listAccounts('profile-a');
  assert.deepEqual(accounts.map(a => a.status), ['expired', 'disconnected', 'disconnected']);
  assert.ok(accounts.every(a => a.capabilities.length === 0));
});

test('health checks fail closed and do not invent posting permissions', async () => {
  for (const [health, expectedStatus, capabilities] of [
    [{ status: 'healthy', tokenStatus: { valid: true }, permissions: { canPost: false, canFetchAnalytics: true } }, 'connected', ['analytics']],
    [{ status: 'warning', tokenStatus: { valid: false }, permissions: { canPost: true } }, 'expired', []],
    [{ status: 'error', tokenStatus: { valid: true }, permissions: { canPost: true } }, 'disconnected', []],
    [{ status: 'healthy', permissions: { canPost: true } }, 'syncing', []],
    [{ accountId: 'foreign', status: 'healthy', tokenStatus: { valid: true }, permissions: { canPost: true } }, 'syncing', []],
  ] as const) {
    const provider = client(async input => String(input).endsWith('/health')
      ? Response.json({ accountId: 'account-a', ...health })
      : Response.json({ accounts: [{ _id: 'account-a', displayName: 'Page' }] }));
    const [account] = await provider.listAccounts('profile-a');
    assert.equal(account?.status, expectedStatus);
    assert.deepEqual(account?.capabilities, capabilities);
  }
  for (const status of [401, 404, 503]) {
    const provider = client(async input => String(input).endsWith('/health')
      ? Response.json({}, { status })
      : Response.json({ accounts: [{ _id: 'account-a', displayName: 'Page' }] }));
    const [account] = await provider.listAccounts('profile-a');
    assert.equal(account?.status, status === 404 ? 'disconnected' : 'syncing');
    assert.deepEqual(account?.capabilities, []);
  }
});

test('malformed account snapshots cannot be treated as an empty successful sync', async () => {
  for (const value of [{}, { accounts: [{}] }]) {
    await assert.rejects(client(async () => Response.json(value)).listAccounts('profile-a'), /Invalid Zernio account/);
  }
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
    workspaceId: '11111111-1111-4111-8111-111111111111', profileId: 'profile-a', platform: 'whatsapp' as const,
    step: 'select_phone_number' as const, tempToken: 'temporary', connectToken: 'connect-secret', expiresAt: 2_000_000_000,
  };
  const selection = await provider.listSelections(context);
  assert.equal(selection.options[0]?.label, 'Support');
  assert.equal(await provider.select(selection.context, selection.options[0]!), 'account-a');
  assert.equal(calls[0]?.url.searchParams.get('profileId'), 'profile-a');
  assert.equal(new Headers(calls[0]?.init?.headers).get('x-connect-token'), 'connect-secret');
  const body = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual({ profileId: body.profileId, phoneNumberId: body.phoneNumberId, wabaId: body.wabaId }, { profileId: 'profile-a', phoneNumberId: 'phone-a', wabaId: 'waba-a' });
});

test('uses a caller-configured shared request limit instead of a fixed plan tier', async () => {
  const client = new ZernioClient({
    baseUrl: 'https://zernio.example', apiKey: 'team-api-key', oauthRedirectUri: 'https://app.example/callback', oauthStateSecret: 'x'.repeat(32),
    globalRequestsPerMinute: 1, now: () => 1_000, fetchImpl: async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 }),
  });
  await client.listAccounts('token');
  await assert.rejects(() => client.listAccounts('token'), SupplierUnavailableError);
  assert.equal(DEFAULT_ZERNIO_CLIENT_RPM, 480);
});
