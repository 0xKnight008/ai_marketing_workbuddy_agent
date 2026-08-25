import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { createSubscriptionServer, deliverDiscordReplies } from './subscribe-server.mjs';

const env = {
  GOOGLE_FORM_EMAIL_ENTRY: '1237653730',
  GOOGLE_FORM_ID: '1FAIpQLSf0snTCY6aXd-eREWUYHvfHUPsdAxRLiCW2KxJanUQomT0ncA',
};

async function withServer(fetchImpl, run, feedbackStore, extraEnv = {}) {
  const server = createSubscriptionServer({ env: { ...env, ...extraEnv }, fetchImpl, feedbackStore });
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

test('stores valid feedback and returns its ticket number', async () => {
  const stored = [];
  const feedbackStore = {
    async create(feedback) { stored.push(feedback); return { ...feedback, ticketId: 'FB-8F3K2Q' }; },
    async setDiscordThread() {},
  };
  await withServer(async () => new Response('', { status: 200 }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/feedback`, {
      body: JSON.stringify({ email: 'support@example.com', name: '  Ada  ', category: 'bug', message: '<b>Cannot</b> save\n a workflow', locale: 'en', pageUrl: 'https://piggybot.example/contact', website: '' }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ticketId: 'FB-8F3K2Q' });
  }, feedbackStore);
  assert.deepEqual(stored, [{ email: 'support@example.com', name: 'Ada', category: 'bug', message: 'Cannot save a workflow', locale: 'en', pageUrl: 'https://piggybot.example/contact' }]);
});

test('feedback honeypot returns a fake success without storing a message', async () => {
  let stored = 0;
  await withServer(async () => new Response('', { status: 200 }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/feedback`, {
      body: JSON.stringify({ email: 'bot@example.com', message: 'spam', website: 'filled' }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ticketId: 'FB-RECEIVED' });
  }, { async create() { stored += 1; }, async setDiscordThread() {} });
  assert.equal(stored, 0);
});

test('feedback validates email and limits requests to three per IP', async () => {
  let stored = 0;
  const feedbackStore = { async create(feedback) { stored += 1; return { ...feedback, ticketId: `FB-${stored}` }; }, async setDiscordThread() {} };
  await withServer(async () => new Response('', { status: 200 }), async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/feedback`, { body: JSON.stringify({ email: 'bad', message: 'hello' }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
    assert.equal(invalid.status, 400);
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`${baseUrl}/api/feedback`, { body: JSON.stringify({ email: 'support@example.com', message: 'hello' }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
      assert.equal(response.status, 201);
    }
    const blocked = await fetch(`${baseUrl}/api/feedback`, { body: JSON.stringify({ email: 'support@example.com', message: 'hello' }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
    assert.equal(blocked.status, 429);
  }, feedbackStore);
  assert.equal(stored, 3);
});

test('feedback rejects oversized payloads and tolerates Discord failures', async () => {
  const feedbackStore = { async create(feedback) { return { ...feedback, ticketId: 'FB-DISCORD' }; }, async setDiscordThread() {} };
  await withServer(async (url) => {
    if (url.startsWith('https://discord.com/')) throw new Error('Discord offline');
    return new Response('', { status: 200 });
  }, async (baseUrl) => {
    const oversized = await fetch(`${baseUrl}/api/feedback`, { body: JSON.stringify({ email: 'support@example.com', message: 'x'.repeat(9_000) }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
    assert.equal(oversized.status, 413);
    const accepted = await fetch(`${baseUrl}/api/feedback`, { body: JSON.stringify({ email: 'support@example.com', message: 'Hello' }), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
    assert.equal(accepted.status, 201);
  }, feedbackStore, { DISCORD_BOT_TOKEN: 'test-token', DISCORD_FEEDBACK_CHANNEL_ID: 'feedback-channel' });
});

test('feedback verifies a configured Turnstile token before storing', async () => {
  let stored = 0;
  let verificationBody;
  const feedbackStore = { async create(feedback) { stored += 1; return { ...feedback, ticketId: 'FB-TURNSTILE' }; }, async setDiscordThread() {} };
  await withServer(async (url, options) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    verificationBody = options.body;
    return Response.json({ success: true });
  }, async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/api/feedback`, { body: JSON.stringify({ email: 'support@example.com', message: 'hello' }), headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.1' }, method: 'POST' });
    assert.equal(missing.status, 403);
    const accepted = await fetch(`${baseUrl}/api/feedback`, { body: JSON.stringify({ email: 'support@example.com', message: 'hello', turnstileToken: 'verified-token' }), headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.2' }, method: 'POST' });
    assert.equal(accepted.status, 201);
  }, feedbackStore, { TURNSTILE_SECRET: 'server-secret' });
  assert.equal(verificationBody.get('secret'), 'server-secret');
  assert.equal(verificationBody.get('response'), 'verified-token');
  assert.equal(stored, 1);
});

test('relays human Discord thread replies through Resend and closes the loop', async () => {
  const calls = [];
  const finished = [];
  const feedbackStore = {
    async pendingDiscordThreads() { return [{ ticketId: 'FB-1234', email: 'customer@example.com', threadId: 'thread-1' }]; },
    async claimDiscordReply(reply) { calls.push(['claim', reply]); return true; },
    async finishDiscordReply(reply) { finished.push(reply); },
    async failDiscordReply() { assert.fail('delivery should not fail'); },
  };
  await deliverDiscordReplies({
    env: { DISCORD_BOT_TOKEN: 'discord-token', DISCORD_FEEDBACK_CHANNEL_ID: 'feedback-channel', RESEND_API_KEY: 'resend-token', FEEDBACK_FROM_EMAIL: 'support@example.com' },
    feedbackStore,
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      if (url.includes('/messages?')) return Response.json([
        { id: 'bot-message', author: { bot: true }, content: 'ignored' },
        { id: 'reply-1', author: { id: 'agent-1', username: 'Ada' }, content: ' We have fixed your workflow. ' },
      ]);
      assert.equal(url, 'https://api.resend.com/emails');
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.to, ['customer@example.com']);
      assert.match(payload.subject, /FB-1234/);
      assert.match(payload.text, /fixed your workflow/);
      return Response.json({ id: 'email-1' });
    },
  });
  assert.equal(finished.length, 1);
  assert.equal(finished[0].messageId, 'reply-1');
  assert.equal(calls.filter(([kind]) => kind === 'claim').length, 1);
});
