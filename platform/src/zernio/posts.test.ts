import assert from 'node:assert/strict';
import test from 'node:test';
import { ZernioClient, SupplierUnavailableError } from './client';
import { postBody, postResult } from './posts';

const action = { type: 'social.create_post', platform: 'x', accountId: 'account', content: 'Approved copy', hashtags: ['#launch'], mode: 'publish_now', idempotencyKey: 'stable-key' };
function response(status = 'published', targetStatus = status, accountId: unknown = 'account') {
  return { post: { _id: 'post-1', status, platforms: [{ platform: 'twitter', accountId, status: targetStatus, platformPostUrl: 'https://x.com/example/status/1' }] } };
}
function client(fetchImpl: typeof fetch) {
  return new ZernioClient({ baseUrl: 'https://zernio.example/api', apiKey: 'test', oauthRedirectUri: 'https://app.example/callback', oauthStateSecret: 'x'.repeat(32), fetchImpl });
}

test('publishing translates the approved action into the official post contract', async () => {
  const provider = client(async (input, init) => {
    assert.equal(String(input), 'https://zernio.example/api/v1/posts');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('idempotency-key'), 'stable-key');
    assert.deepEqual(JSON.parse(String(init?.body)), { content: 'Approved copy #launch', platforms: [{ platform: 'twitter', accountId: 'account' }], publishNow: true });
    return Response.json(response(), { status: 201 });
  });
  assert.equal((await provider.executeAction('stable-key', action)).status, 'published');
  assert.deepEqual(postBody({ ...action, mode: 'schedule', scheduledAt: '2026-12-01T10:00:00Z' }), {
    content: 'Approved copy #launch', platforms: [{ platform: 'twitter', accountId: 'account' }], scheduledFor: '2026-12-01T10:00:00Z',
  });
  assert.throws(() => postBody({ ...action, mode: 'schedule' }), /requires scheduledAt/);
  assert.throws(() => postBody({ ...action, type: 'social.get_analytics' }), /Unsupported/);
});

test('partial, failed and draft responses are never publication success', () => {
  for (const status of ['failed', 'partial', 'partial_success', 'draft', 'unknown']) {
    assert.equal(postResult(response(status, 'published'), action).status, 'failed');
  }
  assert.equal(postResult(response(), action, 207).status, 'failed');
  assert.equal(postResult(response('published', 'failed'), action).status, 'failed');
  assert.equal(postResult(response('scheduled', 'pending'), action).status, 'pending');
  assert.equal(postResult(response('published', 'published', { _id: 'account' }), action).status, 'published');
  assert.throws(() => postResult(response('published', 'published', 'foreign'), action), /target/);
  assert.throws(() => postResult({ posted: true }, action), /post ID/);
  assert.deepEqual(postResult({ postId: 'post-1' }, action, 202), { postId: 'post-1', platform: 'twitter', accountId: 'account', status: 'pending' });
});

test('GET reconciliation binds post ID and account; 409 in-progress is retryable', async () => {
  const provider = client(async (input, init) => {
    assert.equal(String(input), 'https://zernio.example/api/v1/posts/post-1');
    assert.equal(init?.method, undefined);
    return Response.json(response());
  });
  assert.equal((await provider.getActionResult('post-1', action)).status, 'published');
  await assert.rejects(client(async () => Response.json(response())).getActionResult('other', action), /post ID mismatch/);
  await assert.rejects(client(async () => Response.json({ code: 'idempotency_conflict' }, { status: 409 })).executeAction('stable-key', action), SupplierUnavailableError);
});

test('transport retries reuse the exact body and idempotency key', async () => {
  const requests: RequestInit[] = [];
  const provider = client(async (_url, init) => {
    requests.push(init!);
    if (requests.length === 1) throw new Error('connection dropped');
    return Response.json(response());
  });
  await provider.executeAction('stable-key', action);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.body, requests[1]?.body);
  assert.equal(new Headers(requests[1]?.headers).get('idempotency-key'), 'stable-key');
});

test('unsupported media and connection-only actions are blocked before provider requests', async () => {
  const provider = client(async () => assert.fail('unsupported publishing must not call the provider'));
  for (const platform of ['instagram', 'tiktok', 'youtube', 'pinterest', 'facebook', 'threads', 'slack', 'telegram']) {
    await assert.rejects(provider.executeAction('key', { ...action, platform }), /unavailable/);
  }
  await assert.rejects(provider.executeAction('key', { ...action, mediaItems: [] }), /Media publishing/);
  assert.equal(postBody({ ...action, platform: 'discord', hashtags: [] }).content, action.content);
});
