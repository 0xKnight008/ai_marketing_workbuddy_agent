// Probe the Moonshot official Flagship channel. Run with
// node --env-file=/etc/piggybot/ai-runtime.env scripts/check-flagship-direct.mjs [--generate].
// No secrets are printed. A paid probe only runs with the explicit flag.
import { fileURLToPath } from 'node:url';

const ROOT = 'https://api.moonshot.ai/v1';
const WIRE_MODEL = 'kimi-k3.1-pro';

export async function checkFlagshipDirect(env = process.env, { generate = false, fetcher = fetch } = {}) {
  if (env.AI_MODEL_ROUTING_MODE !== 'three-channel') {
    throw new Error('Keep AI_MODEL_ROUTING_MODE=three-channel so all three bands use their official channels');
  }
  if (!env.DEEPSEEK_API_KEY || !env.ZAI_API_KEY) {
    throw new Error('Existing Eco/Standard direct-channel credentials must remain configured');
  }
  const apiKey = env.MOONSHOT_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing required env var: MOONSHOT_API_KEY');

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const call = async (url, init = {}) => {
    let r;
    try {
      r = await fetcher(url, { ...init, signal: AbortSignal.timeout(190000) });
    } catch {
      throw new Error('Moonshot connection failed');
    }
    if (!r.ok) throw new Error(`Moonshot check failed (HTTP ${r.status}); verify the official API key`);
    try {
      return await r.json();
    } catch {
      throw new Error('Moonshot returned invalid JSON');
    }
  };

  const models = await call(`${ROOT}/models`, { headers });
  if (!models.data?.some((m) => m.id === WIRE_MODEL)) {
    throw new Error(`Key cannot access ${WIRE_MODEL}`);
  }
  if (!generate) return { ok: true, mode: 'read-only', model: WIRE_MODEL };

  // K3 series only supports json_object plus prompt-side schema instructions.
  const r = await call(`${ROOT}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: WIRE_MODEL,
      messages: [
        { role: 'system', content: 'Respond with a JSON object of the form {"ok": true} and nothing else.' },
        { role: 'user', content: 'Return JSON with ok true.' },
      ],
      max_tokens: 128,
      stream: false,
      response_format: { type: 'json_object' },
    }),
  });
  let parsed;
  try {
    parsed = JSON.parse(r.choices?.[0]?.message?.content);
  } catch {
    throw new Error('Flagship structured output is invalid');
  }
  if (parsed?.ok !== true || !Number.isFinite(r.usage?.prompt_tokens) || !Number.isFinite(r.usage?.completion_tokens)) {
    throw new Error('Flagship response or token usage did not meet acceptance criteria');
  }
  return {
    ok: true,
    mode: 'paid-generation',
    model: r.model,
    promptTokens: r.usage.prompt_tokens,
    completionTokens: r.usage.completion_tokens,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkFlagshipDirect(process.env, { generate: process.argv.includes('--generate') })
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
