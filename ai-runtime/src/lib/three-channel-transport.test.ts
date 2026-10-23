import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { loadConfig } from '../config';
import { modelForBand } from './model-routing';
import { chatCompletionsModel } from './chat-completions-model';
import { structuredOutputForBand } from './structured-output';
import { createClient } from '@libsql/client';
import { createTokenLedger, tokenUsageOptions } from './token-ledger';

test('installed Mastra sends channel-specific Chat Completions requests and parses structured results', async (t) => {
  const env = {
    AI_MODEL_ROUTING_MODE: 'three-channel', OPENAI_BASE_URL: 'https://litellm.test/v1',
    OPENAI_API_KEY: 'litellm-virtual-test', DEEPSEEK_API_KEY: 'ds-test', ZAI_API_KEY: 'glm-test',
    AI_MODEL_FLAGSHIP: 'openai/primary-flagship',
  };
  const config = loadConfig(env);
  const cases = [
    ['eco', 'primary', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-flash', 'ds-test'],
    ['eco', 'fallback', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-flash', 'ds-test'],
    ['standard', 'primary', 'https://api.z.ai/api/paas/v4/chat/completions', 'glm-5.3-flash', 'glm-test'],
    ['flagship', 'primary', 'https://litellm.test/v1/chat/completions', 'primary-flagship', 'litellm-virtual-test'],
  ] as const;
  for (const [band, provider, url, wireModel, key] of cases) {
    let requests = 0;
    let reply: unknown = { ok: true };
    let omitUsage = false;
    const mocked = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      requests++;
      assert.equal(String(input), url);
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, wireModel);
      if (body.stream) assert.equal(body.stream_options?.include_usage, true, 'streaming calls must request usage');
      if (band !== 'flagship') {
        assert.notEqual(body.response_format?.type, 'json_schema');
        assert.ok(body.messages.some((message: { content?: unknown }) =>
          typeof message.content === 'string' && message.content.includes('"ok"')));
      }
      const output = JSON.stringify(reply);
      const base = { id: 'test-completion', object: 'chat.completion', created: 1, model: wireModel };
      if (!body.stream) {
        return Response.json({ ...base, choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }], ...(!omitUsage ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}) });
      }
      const chunks = [
        { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: output }, finish_reason: null }] },
        { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], ...(!omitUsage ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}) },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    try {
      const client = createClient({ url: 'file::memory:' });
      const ledger = createTokenLedger(client);
      const model = modelForBand(config, band, provider);
      const contextRunId = `workflow-${band}-${provider}`;
      const agent = new Agent({ id: `test-${band}-${provider}`, name: 'transport-test', instructions: 'Return JSON with ok true.', model: chatCompletionsModel(model, env), defaultOptions: tokenUsageOptions(model, 'transport-test', ledger, env, contextRunId) });
      const result = await agent.generate('Return JSON.', { structuredOutput: structuredOutputForBand(z.object({ ok: z.boolean() }), band, env) });
      assert.deepEqual(result.object, { ok: true });
      assert.equal(requests, 1);
      const rows = await ledger.list(Number.MAX_SAFE_INTEGER, '');
      assert.equal(rows.length, 1);
      assert.ok(rows[0]);
      assert.equal(rows[0].run_id, contextRunId);
      assert.equal((await ledger.list(Number.MAX_SAFE_INTEGER,contextRunId)).length,1);
      assert.equal(rows[0].prompt_tokens, 10);
      assert.equal(rows[0].completion_tokens, 5);
      assert.equal(rows[0].model_name, wireModel);
      assert.equal(rows[0].provider, band === 'eco' ? 'deepseek' : band === 'standard' ? 'zai' : 'configured-proxy');
      if (band !== 'flagship') {
        reply = { ok: 'invalid-boolean' };
        await assert.rejects(agent.generate('Return JSON.', {
          structuredOutput: structuredOutputForBand(z.object({ ok: z.boolean() }), band, env),
        }));
        assert.equal((await ledger.list(Number.MAX_SAFE_INTEGER, '')).length, 2, 'invalid structured result still consumed tokens');
      }
      omitUsage = true;
      reply = { ok: true };
      await agent.generate('Return JSON.', { structuredOutput: structuredOutputForBand(z.object({ ok: z.boolean() }), band, env) });
      const [missing] = await ledger.list(Number.MAX_SAFE_INTEGER, '');
      assert.ok(missing);
      assert.equal(missing.prompt_tokens, null);
      assert.equal(missing.completion_tokens, null);
      client.close();
    } finally {
      mocked.mock.restore();
    }
  }
});
