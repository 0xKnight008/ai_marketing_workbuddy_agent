import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeDiscordImport, readDiscordMessages } from './discord';

const workspace = '11111111-1111-4111-8111-111111111111';
const channel = '123456789012345678';
const config = { DISCORD_IMPORT_BOT_TOKEN: 'test-only', DISCORD_IMPORT_CHANNELS: JSON.stringify({ [workspace]: [channel] }) };
const message = (n: number) => ({ id: String(200000000000000000n + BigInt(n)), channel_id: channel,
  author: { id: '333333333333333333', bot: false }, content: `Message ${n}`, type: 0, timestamp: '2026-09-15T00:00:00Z' });

test('unconfigured and cross-tenant channels fail closed before any network call', async () => {
  assert.throws(() => authorizeDiscordImport({}, workspace, channel), /not_configured/);
  assert.throws(() => authorizeDiscordImport({ ...config, DISCORD_IMPORT_CHANNELS: '{' }, workspace, channel), /configuration_invalid/);
  await assert.rejects(readDiscordMessages(config, '22222222-2222-4222-8222-222222222222', channel, async () => assert.fail('no network')), /channel_not_allowed/);
});

test('five-page snapshot follows opaque snowflake cursors and preserves originals and author identity', async () => {
  let calls = 0;
  const items = await readDiscordMessages(config, workspace, channel, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://discord.com');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bot test-only');
    assert.ok(init?.signal);
    if (calls) assert.equal(url.searchParams.get('before'), message(501 - calls * 100).id);
    const page = Array.from({ length: 100 }, (_, i) => message(500 - calls * 100 - i));
    calls++;
    return Response.json(page);
  });
  assert.equal(calls, 5);
  assert.equal(items.length, 500);
  assert.equal(items[0]!.text, 'Message 1');
  assert.equal(items[0]!.author, '333333333333333333');
  assert.equal(items[0]!.metrics.channelId, channel);
});

test('filters bots, webhooks, system and blank messages and deduplicates IDs', async () => {
  const human = { ...message(1), content: ' original\ntext ' };
  const items = await readDiscordMessages(config, workspace, channel, async () => Response.json([
    human, human, { ...message(2), author: { ...message(2).author, bot: true } },
    { ...message(3), webhook_id: '123' }, { ...message(4), type: 7 }, { ...message(5), content: ' ' },
  ]));
  assert.equal(items.length, 1);
  assert.equal(items[0]!.text, human.content);
});

test('rate limits, hidden content, malformed or foreign results and long text fail without partial output', async () => {
  for (const [response, code] of [
    [new Response('private error', { status: 429 }), /rate_limited/],
    [new Response('private error', { status: 403 }), /check_bot_channel_permissions/],
    [Response.json([]), /no_text/],
    [Response.json([{ ...message(1), channel_id: '444444444444444444' }]), /invalid_response/],
    [Response.json([{ ...message(1), content: 'x'.repeat(2001) }]), /exceeds_2000/],
    [Response.json({ secret: 'not a message list' }), /invalid_response/],
  ] as const) await assert.rejects(readDiscordMessages(config, workspace, channel, async () => response), code);
  let calls = 0;
  await assert.rejects(readDiscordMessages(config, workspace, channel, async () => {
    calls++;
    return Response.json(Array.from({ length: 100 }, (_, i) => message(200 - i)));
  }), /invalid_pagination/);
  assert.equal(calls, 2);
  await assert.rejects(readDiscordMessages(config, workspace, channel, async () => { throw new Error('private token'); }), /provider_unavailable/);
});
