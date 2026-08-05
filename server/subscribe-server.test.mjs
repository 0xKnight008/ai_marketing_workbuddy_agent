import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createSubscriptionServer } from './subscribe-server.mjs';

const env = {
  GOOGLE_FORM_EMAIL_ENTRY: '1237653730',
  GOOGLE_FORM_ID: '1FAIpQLSf0snTCY6aXd-eREWUYHvfHUPsdAxRLiCW2KxJanUQomT0ncA',
};

async function withServer(fetchImpl, run) {
  const server = createSubscriptionServer({ env, fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('forwards a valid email after Google Forms accepts it', async () => {
  let formBody;
  await withServer(async (_url, options) => {
    formBody = options.body;
    return new Response('', { status: 200 });
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/subscribe`, {
      body: JSON.stringify({ email: 'test@example.com' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { accepted: true });
  });
  assert.equal(formBody.get('entry.1237653730'), 'test@example.com');
});

test('rejects invalid emails before calling Google Forms', async () => {
  let calls = 0;
  await withServer(async () => {
    calls += 1;
    return new Response('', { status: 200 });
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/subscribe`, {
      body: JSON.stringify({ email: 'not-an-email' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_email' });
  });
  assert.equal(calls, 0);
});

test('returns an error when Google Forms rejects the request', async () => {
  await withServer(async () => new Response('', { status: 403 }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/subscribe`, {
      body: JSON.stringify({ email: 'test@example.com' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'subscription_unavailable' });
  });
});

test('rate limits repeated requests from one address', async () => {
  let calls = 0;
  await withServer(async () => {
    calls += 1;
    return new Response('', { status: 200 });
  }, async (baseUrl) => {
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${baseUrl}/api/subscribe`, {
        body: JSON.stringify({ email: 'test@example.com' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      assert.equal(response.status, 201);
    }

    const blocked = await fetch(`${baseUrl}/api/subscribe`, {
      body: JSON.stringify({ email: 'test@example.com' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(blocked.status, 429);
  });
  assert.equal(calls, 5);
});
