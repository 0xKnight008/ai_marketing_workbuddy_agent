import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverDiscordReplies, supportReplyConfiguration } from './feedback-delivery.mjs';

const env = { DISCORD_BOT_TOKEN: 'test-discord', DISCORD_FEEDBACK_CHANNEL_ID: '1', RESEND_API_KEY: 'test-resend', RESEND_FROM_EMAIL: 'support@example.com' };
const human = (id, content = 'Fixed your issue.') => ({ id: String(id), type: 0, author: { id: '42' }, content });

function fixture(tickets = [{ ticketId: 'FB-TEST', threadId: '100', email: 'customer@example.com' }]) {
  const replies = new Map();
  const errors = [];
  const sent = [];
  const messages = new Map(tickets.map((ticket) => [ticket.threadId, []]));
  const store = {
    async pendingDiscordThreads() { return tickets.filter((ticket) => !ticket.closed); },
    async markDiscordPoll(ticketId) { tickets.find((ticket) => ticket.ticketId === ticketId).polled = true; },
    async failDiscordPoll(ticketId, code) { errors.push({ ticketId, code }); },
    async advanceDiscordCursor(ticketId, id) { tickets.find((ticket) => ticket.ticketId === ticketId).lastMessageId = id; },
    async claimDiscordReply(reply) {
      const existing = replies.get(reply.messageId);
      if (existing?.state === 'sent') return { state: 'sent' };
      if (existing?.state === 'pending') return { state: 'busy' };
      const entry = { state: 'pending', reply: existing?.reply || structuredClone(reply) };
      replies.set(reply.messageId, entry);
      return { state: 'claimed', reply: entry.reply };
    },
    async finishDiscordReply(reply, id) {
      replies.get(reply.messageId).state = 'sent';
      replies.get(reply.messageId).providerId = id;
      if (reply.body.toLowerCase() === '/close') tickets.find((ticket) => ticket.ticketId === reply.ticketId).closed = true;
      return true;
    },
    async failDiscordReply(reply) { replies.get(reply.messageId).state = 'failed'; },
  };
  const fetchImpl = async (url, options) => {
    if (url.startsWith('https://discord.com/')) {
      const parsed = new URL(url);
      const threadId = parsed.pathname.split('/')[4];
      return Response.json(messages.get(threadId).filter((message) => BigInt(message.id) > BigInt(parsed.searchParams.get('after'))).slice(0, 100).reverse());
    }
    assert.equal(url, 'https://api.resend.com/emails');
    sent.push({ payload: JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
    return Response.json({ id: `email-${sent.length}` });
  };
  const run = (overrides = {}) => deliverDiscordReplies({ env, feedbackStore: store, fetchImpl, reportError() {}, ...overrides });
  return { tickets, replies, errors, sent, messages, store, fetchImpl, run };
}

test('sender falls back to platform Resend sender; partial configuration fails explicitly', () => {
  assert.equal(supportReplyConfiguration(env), true);
  assert.equal(supportReplyConfiguration({ RESEND_API_KEY: 'activation-only' }), false);
  assert.equal(supportReplyConfiguration({ DISCORD_BOT_TOKEN: 'x', DISCORD_REPLY_DELIVERY_ENABLED: 'false' }), false);
  assert.throws(() => supportReplyConfiguration({ ...env, RESEND_FROM_EMAIL: undefined }), /FEEDBACK_FROM_EMAIL or RESEND_FROM_EMAIL/);
});

test('paginates oldest-first, ignores bots/webhooks/system messages, and resumes without duplicates', async () => {
  const f = fixture();
  f.messages.set('100', [
    { ...human(101), author: { bot: true } },
    { ...human(102), webhook_id: '55' },
    { ...human(103), type: 21 },
    ...Array.from({ length: 105 }, (_, index) => human(104 + index)),
  ]);
  await f.run();
  assert.equal(f.sent.length, 105);
  assert.equal(f.sent[0].key, 'feedback-reply/104');
  assert.equal(f.sent.at(-1).key, 'feedback-reply/208');
  assert.equal(f.sent[0].payload.from, env.RESEND_FROM_EMAIL);
  assert.deepEqual(f.sent[0].payload.to, ['customer@example.com']);
  assert.equal(f.tickets[0].lastMessageId, '208');
  await f.run();
  f.tickets[0].lastMessageId = null; // Durable sent state survives cursor replay.
  await f.run();
  assert.equal(f.sent.length, 105);
  assert.deepEqual(f.errors, []);
});

test('failed Resend delivery retains cursor and retries the original payload after an edit', async () => {
  const f = fixture();
  f.messages.set('100', [human(101, 'Original reply')]);
  let firstPayload;
  await f.run({ fetchImpl: async (url, options) => {
    if (url.includes('resend.com')) { firstPayload = JSON.parse(options.body); return new Response('', { status: 503 }); }
    return f.fetchImpl(url, options);
  } });
  assert.equal(f.tickets[0].lastMessageId, undefined);
  assert.equal(f.replies.get('101').state, 'failed');
  f.messages.set('100', [human(101, 'Edited reply')]);
  await f.run();
  assert.deepEqual(f.sent[0].payload, firstPayload);
  assert.equal(f.sent[0].key, 'feedback-reply/101');
  assert.equal(f.replies.get('101').providerId, 'email-1');
  assert.equal(f.tickets[0].lastMessageId, '101');
});

test('missing content is actionable and recoverable after MESSAGE_CONTENT is enabled', async () => {
  const f = fixture();
  f.messages.set('100', [human(101, '')]);
  await f.run();
  assert.equal(f.tickets[0].lastMessageId, undefined);
  assert.deepEqual(f.errors, [{ ticketId: 'FB-TEST', code: 'discord_reply_content_missing' }]);
  f.messages.set('100', [human(101)]);
  await f.run();
  assert.equal(f.sent.length, 1);
});

test('one inaccessible thread does not prevent other customers receiving replies', async () => {
  const f = fixture([{ ticketId: 'FB-ONE', threadId: '100', email: 'one@example.com' }, { ticketId: 'FB-TWO', threadId: '200', email: 'two@example.com' }]);
  f.messages.set('200', [human(201)]);
  await f.run({ fetchImpl: (url, options) => url.includes('/channels/100/') ? new Response('', { status: 403 }) : f.fetchImpl(url, options) });
  assert.deepEqual(f.errors, [{ ticketId: 'FB-ONE', code: 'discord_thread_messages_failed_403' }]);
  assert.deepEqual(f.sent[0].payload.to, ['two@example.com']);
  assert.ok(f.tickets.every((ticket) => ticket.polled));
});

test('busy claims do not skip a reply or spam error logs', async () => {
  const f = fixture();
  f.messages.set('100', [human(101), human(102)]);
  f.store.claimDiscordReply = async () => ({ state: 'busy' });
  await f.run({ reportError() { assert.fail('ordinary contention is not logged'); } });
  assert.equal(f.tickets[0].lastMessageId, undefined);
  assert.equal(f.sent.length, 0);
});

test('/close sends one closure email and stops further replies for the closed ticket', async () => {
  const f = fixture();
  f.messages.set('100', [human(101, '/close'), human(102)]);
  await f.run();
  await f.run();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].payload.text, /ticket has been closed/);
  assert.equal(f.tickets[0].lastMessageId, '101');
});

test('provider acknowledgement without an ID is not treated as sent', async () => {
  const f = fixture();
  f.messages.set('100', [human(101)]);
  await f.run({ fetchImpl: (url, options) => url.includes('resend.com') ? Response.json({}) : f.fetchImpl(url, options) });
  assert.equal(f.replies.get('101').state, 'failed');
  assert.equal(f.tickets[0].lastMessageId, undefined);
  assert.equal(f.errors[0].code, 'resend_delivery_missing_id');
});

test('uncertain acknowledgement retries with the same payload and idempotency key', async () => {
  const f = fixture();
  f.messages.set('100', [human(101)]);
  const finish = f.store.finishDiscordReply;
  f.store.finishDiscordReply = async () => { throw new Error('private database connection details'); };
  await f.run();
  assert.equal(f.errors[0].code, 'feedback_delivery_failed');
  assert.equal(f.tickets[0].lastMessageId, undefined);
  f.store.finishDiscordReply = finish;
  await f.run();
  assert.deepEqual(f.sent[0], f.sent[1]);
});
