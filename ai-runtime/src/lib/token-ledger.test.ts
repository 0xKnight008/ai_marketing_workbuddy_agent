import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@libsql/client';
import { createTokenLedger, tokenCount, tokenUsageOptions } from './token-ledger';

test('ledger preserves unknown usage, paginates without overlap, and deduplicates event IDs', async () => {
  const client = createClient({ url: 'file::memory:' });
  const ledger = createTokenLedger(client);
  try {
    for (let i = 0; i < 103; i++) {
      const row = { event_id: `event-${i}`, created_at: new Date().toISOString(), operation: 'test', provider: 'deepseek', requested_model: 'alias', model_name: 'actual', prompt_tokens: i, completion_tokens: null };
      await ledger.record(row);
      await ledger.record(row);
    }
    const first = await ledger.list(Number.MAX_SAFE_INTEGER, 'deepseek');
    assert.equal(first.length, 100);
    assert.ok(first[0]);
    assert.equal(first[0].completion_tokens, null);
    const rest = await ledger.list(Number(first.at(-1)!.id), 'deepseek');
    assert.equal(rest.length, 3);
    assert.equal(new Set([...first, ...rest].map(row => row.id)).size, 103);
    assert.deepEqual(await ledger.list(Number.MAX_SAFE_INTEGER, "' OR 1=1 --"), []);
    await tokenUsageOptions('openai/test', 'unknown', ledger, {}).onStepFinish({});
    const [unknown] = await ledger.list(Number.MAX_SAFE_INTEGER, '');
    assert.ok(unknown);
    assert.equal(unknown.prompt_tokens, null);
    assert.equal(unknown.completion_tokens, null);
  } finally { client.close(); }
});

test('token counts never fabricate zero for missing, fractional or unsafe values', () => {
  for (const value of [undefined, null, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100']) assert.equal(tokenCount(value), null);
  assert.equal(tokenCount(0), 0);
  assert.equal(tokenCount(100), 100);
});
