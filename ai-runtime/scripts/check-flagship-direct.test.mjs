import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFlagshipDirect } from './check-flagship-direct.mjs';

const env = {
  AI_MODEL_ROUTING_MODE: 'three-channel',
  MOONSHOT_API_KEY: 'moonshot-test',
  OPENAI_API_KEY: 'virtual-test',
  OPENAI_BASE_URL: 'http://127.0.0.1:4400/v1',
  DEEPSEEK_API_KEY: 'ds-test',
  ZAI_API_KEY: 'zai-test',
};

test('read-only probe verifies the official key and model visibility without a completion', async () => {
  const urls = [];
  const result = await checkFlagshipDirect(env, {
    fetcher: async (url, init) => {
      urls.push(url);
      if (url.endsWith('/models')) assert.equal(init.headers.Authorization, 'Bearer moonshot-test');
      return Response.json(url.endsWith('/models') ? { data: [{ id: 'kimi-k3.1-pro' }, { id: 'kimi-k3.1-pro-highspeed' }] } : {});
    },
  });
  assert.deepEqual(result, { ok: true, mode: 'read-only', model: 'kimi-k3.1-pro' });
  assert.equal(urls.length, 1);
  assert.ok(urls.every((u) => !u.includes('completions')));
});

test('explicit paid probe uses json_object and reports token counts', async () => {
  let calls = 0;
  const result = await checkFlagshipDirect(env, {
    generate: true,
    fetcher: async (url, init) => {
      calls++;
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'kimi-k3.1-pro' }] });
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'kimi-k3.1-pro');
      assert.equal(body.response_format.type, 'json_object');
      return Response.json({
        model: 'kimi-k3.1-pro',
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.model, 'kimi-k3.1-pro');
  assert.equal(result.completionTokens, 7);
});

test('fails closed without the official key or outside three-channel mode', async () => {
  await assert.rejects(checkFlagshipDirect({ ...env, MOONSHOT_API_KEY: ' ' }, {}), /MOONSHOT_API_KEY/);
  await assert.rejects(checkFlagshipDirect({ ...env, AI_MODEL_ROUTING_MODE: 'litellm' }, {}), /three-channel/);
});

test('401 errors stay safe and never trigger an Eco or Standard fallback', async () => {
  const urls = [];
  await assert.rejects(
    checkFlagshipDirect(env, {
      fetcher: async (url) => {
        urls.push(url);
        return new Response('invalid api key', { status: 401 });
      },
    }),
    /HTTP 401/,
  );
  assert.equal(urls.length, 1);
});
