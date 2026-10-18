import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { loadConfig } from '../config';
import { modelForBand } from './model-routing';
import { chatCompletionsModel } from './chat-completions-model';
import { structuredOutputForBand } from './structured-output';

test('installed Mastra sends channel-specific Chat Completions requests and parses structured results', async (t) => {
  const env = {
    AI_MODEL_ROUTING_MODE: 'three-channel', OPENAI_BASE_URL: 'https://proxy.test/v1',
    OPENAI_API_KEY: 'proxy-test', DEEPSEEK_API_KEY: 'ds-test', ZAI_API_KEY: 'glm-test',
    AI_MODEL_FLAGSHIP: 'openai/sol-router-alias',
  };
  const config = loadConfig(env);
  const cases = [
    ['eco', 'primary', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-flash', 'ds-test'],
    ['eco', 'fallback', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-flash', 'ds-test'],
    ['standard', 'primary', 'https://api.z.ai/api/paas/v4/chat/completions', 'glm-5.3-flash', 'glm-test'],
    ['flagship', 'primary', 'https://proxy.test/v1/chat/completions', 'sol-router-alias', 'proxy-test'],
  ] as const;
  for (const [band, provider, url, wireModel, key] of cases) {
    let requests = 0;
    let reply: unknown = { ok: true };
    const mocked = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      requests++;
      assert.equal(String(input), url);
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, wireModel);
      if (band !== 'flagship') {
        assert.notEqual(body.response_format?.type, 'json_schema');
        assert.ok(body.messages.some((message: { content?: unknown }) =>
          typeof message.content === 'string' && message.content.includes('"ok"')));
      }
      const output = JSON.stringify(reply);
      const base = { id: 'test-completion', object: 'chat.completion', created: 1, model: wireModel };
      if (!body.stream) {
        return Response.json({ ...base, choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
      }
      const chunks = [
        { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: output }, finish_reason: null }] },
        { ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    try {
      const agent = new Agent({ id: `test-${band}-${provider}`, name: 'transport-test', instructions: 'Return JSON with ok true.', model: chatCompletionsModel(modelForBand(config, band, provider), env) });
      const result = await agent.generate('Return JSON.', { structuredOutput: structuredOutputForBand(z.object({ ok: z.boolean() }), band, env) });
      assert.deepEqual(result.object, { ok: true });
      assert.equal(requests, 1);
      if (band !== 'flagship') {
        reply = { ok: 'invalid-boolean' };
        await assert.rejects(agent.generate('Return JSON.', {
          structuredOutput: structuredOutputForBand(z.object({ ok: z.boolean() }), band, env),
        }));
      }
    } finally {
      mocked.mock.restore();
    }
  }
});
