import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { createReplyStore, deliverDiscordReplies } from '../../server/feedback-delivery.mjs';

test('feedback delivery migration and durable claims on PostgreSQL', async (t) => {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL must point to an empty disposable PostgreSQL database');
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const existing = await client.query("SELECT to_regclass('public.app_user') AS users, to_regclass('public.feedback_message') AS feedback");
    assert.deepEqual(existing.rows[0], { users: null, feedback: null }, 'Refusing to run against an existing platform database');
    const directory = new URL('../migrations/', import.meta.url);
    const migration = '0016_feedback_reply_delivery.sql';
    for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql') && name < migration).sort()) {
      await client.query(await readFile(new URL(name, directory), 'utf8'));
    }
    await client.query("INSERT INTO feedback_message (ticket_no, email, message, discord_thread_id) VALUES ('FB-TEST', 'customer@example.com', 'Help', '100')");
    await client.query(`INSERT INTO feedback_reply (ticket_no, direction, body, provider_message_id, delivery_status, created_at)
      VALUES ('FB-TEST', 'outbound', 'Old uncertain send', '101', 'pending', now() - interval '2 days')`);
    await client.query(await readFile(new URL(migration, directory), 'utf8'));
    const store = createReplyStore(client);
    const reply = (messageId = '102') => ({ ticketId: 'FB-TEST', messageId, author: 'discord:42', body: 'Original reply', emailPayload: { from: 'support@example.com', to: ['customer@example.com'], subject: 'Ticket reply', text: 'Original reply' } });
    const row = async (id = '102') => (await client.query('SELECT * FROM feedback_reply WHERE provider_message_id = $1', [id])).rows[0];
    const scenario = (name, run) => t.test(name, async () => {
      await client.query('SAVEPOINT scenario');
      try { await run(); } finally { await client.query('ROLLBACK TO SAVEPOINT scenario'); await client.query('RELEASE SAVEPOINT scenario'); }
    });

    await scenario('legacy uncertain sends retain their age and require reconciliation', async () => {
      assert.ok((await row('101')).delivery_first_attempt_at);
      await assert.rejects(store.claimDiscordReply(reply('101')), /resend_delivery_reconciliation_required/);
    });
    await scenario('live claim excludes a second worker; sent rows cannot be reset', async () => {
      const first = await store.claimDiscordReply(reply());
      assert.equal(first.state, 'claimed');
      assert.deepEqual(await store.claimDiscordReply(reply()), { state: 'busy' });
      assert.equal(await store.finishDiscordReply(first.reply, 'resend-accepted-id'), true);
      const delivered = await row();
      assert.equal(delivered.delivery_status, 'sent');
      assert.equal(delivered.provider_delivery_id, 'resend-accepted-id');
      assert.ok(delivered.sent_at);
      assert.deepEqual(await store.claimDiscordReply(reply()), { state: 'sent' });
      await store.failDiscordReply(first.reply, 'resend_delivery_failed_503');
      assert.deepEqual(await row(), delivered);
    });
    await scenario('failed delivery retries with frozen payload, author and body', async () => {
      const first = await store.claimDiscordReply(reply());
      await store.failDiscordReply(first.reply, 'resend_delivery_failed_503');
      const retry = await store.claimDiscordReply({ ...reply(), body: 'Edited', author: 'discord:other', emailPayload: { ...reply().emailPayload, text: 'Edited' } });
      assert.equal(retry.state, 'claimed');
      assert.notEqual(retry.reply.claimToken, first.reply.claimToken);
      assert.deepEqual(retry.reply.emailPayload, first.reply.emailPayload);
      assert.equal(retry.reply.body, 'Original reply');
      assert.equal(retry.reply.author, 'discord:42');
      assert.equal(await store.finishDiscordReply(first.reply, 'stale'), false);
      await store.failDiscordReply(first.reply, 'feedback_delivery_failed');
      assert.equal((await row()).delivery_status, 'pending');
      assert.equal(await store.finishDiscordReply(retry.reply, 'current'), true);
    });
    await scenario('expired lease is reclaimed but a delivery older than 23 hours is not resent', async () => {
      const first = await store.claimDiscordReply(reply());
      await client.query("UPDATE feedback_reply SET delivery_locked_until = now() - interval '1 second' WHERE provider_message_id = '102'");
      const retry = await store.claimDiscordReply(reply());
      assert.equal(retry.state, 'claimed');
      assert.notEqual(retry.reply.claimToken, first.reply.claimToken);
      await client.query("UPDATE feedback_reply SET delivery_locked_until = NULL, delivery_first_attempt_at = now() - interval '24 hours' WHERE provider_message_id = '102'");
      await assert.rejects(store.claimDiscordReply(reply()), /resend_delivery_reconciliation_required/);
    });
    await scenario('cursor only advances and polling rotates beyond the oldest twenty tickets', async () => {
      await store.advanceDiscordCursor('FB-TEST', '200');
      await store.advanceDiscordCursor('FB-TEST', '150');
      assert.equal((await store.pendingDiscordThreads())[0].lastMessageId, '200');
      await client.query(`INSERT INTO feedback_message (ticket_no, email, message, discord_thread_id)
        SELECT 'FB-' || n, 'test@example.com', 'Help', (1000 + n)::text FROM generate_series(1, 25) AS n`);
      const batch = await store.pendingDiscordThreads();
      assert.equal(batch.length, 20);
      for (const ticket of batch) await store.markDiscordPoll(ticket.ticketId);
      const next = await store.pendingDiscordThreads();
      assert.equal(next.slice(0, 6).filter((ticket) => batch.some((old) => old.ticketId === ticket.ticketId)).length, 0);
      await store.failDiscordPoll('FB-TEST', 'discord_reply_content_missing');
      assert.equal((await client.query("SELECT discord_poll_error FROM feedback_message WHERE ticket_no = 'FB-TEST'")).rows[0].discord_poll_error, 'discord_reply_content_missing');
      await store.markDiscordPoll('FB-TEST');
      assert.equal((await client.query("SELECT discord_poll_error FROM feedback_message WHERE ticket_no = 'FB-TEST'")).rows[0].discord_poll_error, null);
    });
    await scenario('delivery cannot reopen a closed ticket', async () => {
      const first = await store.claimDiscordReply(reply());
      await client.query("UPDATE feedback_message SET status = 'closed' WHERE ticket_no = 'FB-TEST'");
      assert.equal(await store.finishDiscordReply(first.reply, 'accepted'), true);
      assert.deepEqual(await store.pendingDiscordThreads(), []);
    });
    await scenario('a provider message cannot be reassigned to another ticket', async () => {
      await store.claimDiscordReply(reply());
      await client.query("INSERT INTO feedback_message (ticket_no, email, message) VALUES ('FB-OTHER', 'other@example.com', 'Help')");
      await assert.rejects(store.claimDiscordReply({ ...reply(), ticketId: 'FB-OTHER' }), /discord_reply_ticket_mismatch/);
    });
    await scenario('relay delivers once using the real SQL adapter and persists its cursor and provider ID', async () => {
      const emails = [];
      const run = () => deliverDiscordReplies({
        env: { DISCORD_BOT_TOKEN: 'test', DISCORD_FEEDBACK_CHANNEL_ID: '1', RESEND_API_KEY: 'test', RESEND_FROM_EMAIL: 'support@example.com' },
        feedbackStore: store,
        reportError(detail) { assert.fail(JSON.stringify(detail)); },
        fetchImpl: async (url, options) => {
          if (url.includes('discord.com')) return Response.json([{ id: '102', content: 'Fixed', author: { id: '42' }, type: 0 }]);
          emails.push(JSON.parse(options.body));
          return Response.json({ id: 'resend-test-id' });
        },
      });
      await run();
      await run();
      assert.equal(emails.length, 1);
      assert.deepEqual(emails[0].to, ['customer@example.com']);
      assert.equal((await row()).provider_delivery_id, 'resend-test-id');
      assert.equal((await store.pendingDiscordThreads())[0].lastMessageId, '102');
    });
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
});
