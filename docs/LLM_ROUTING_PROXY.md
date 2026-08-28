# Production LLM routing proxy

Mastra resolves every `openai/<model>` string through the same
`OPENAI_API_KEY` and `OPENAI_BASE_URL`. Because 1token.ai and Kimi are separate
OpenAI-compatible endpoints, production must put a model-aware proxy such as
one-api or new-api in front of ai-runtime. Directly switching those two
environment variables cannot provide dual-supplier routing.

## Required topology

```text
ai-runtime
  OPENAI_BASE_URL=https://llm-router.internal.example/v1
  OPENAI_API_KEY=<router-issued key>
        |
        +-- primary-* aliases  -> 1token.ai channel
        +-- fallback-* aliases -> Kimi channel
```

Keep both suppliers' API keys in the proxy secret store. ai-runtime receives
only a restricted proxy key, and the proxy endpoint should be private or
network-restricted to the runtime hosts.

## Proxy alias contract

Register these logical aliases in the proxy. Map the primary aliases to the
reviewed 1token.ai models and the fallback aliases to capability-compatible
Kimi models. The upstream model names remain a proxy concern.

| ai-runtime value | Proxy alias | Upstream channel |
| --- | --- | --- |
| `openai/primary-eco` | `primary-eco` | 1token.ai |
| `openai/primary-standard` | `primary-standard` | 1token.ai |
| `openai/primary-flagship` | `primary-flagship` | 1token.ai |
| `openai/fallback-eco` | `fallback-eco` | 1token.ai |
| `openai/fallback-standard` | `fallback-standard` | 1token.ai |
| `openai/fallback-flagship` | `fallback-flagship` | 1token.ai |

Every routed model must support the OpenAI chat-completions features used by
the agents, including structured output. Confirm rate limits, context windows,
and output limits for each alias before assigning it to a band.

## ai-runtime production environment

```dotenv
NODE_ENV=production
AI_MODEL_ROUTING_MODE=proxy
OPENAI_BASE_URL=https://llm-router.internal.example/v1
OPENAI_API_KEY=<router-issued-key>

AI_MODEL_ECO=openai/primary-eco
AI_MODEL_STANDARD=openai/primary-standard
AI_MODEL_FLAGSHIP=openai/primary-flagship
AI_MODEL_ECO_FALLBACK=openai/fallback-eco
AI_MODEL_STANDARD_FALLBACK=openai/fallback-standard
AI_MODEL_FLAGSHIP_FALLBACK=openai/fallback-flagship
```

Startup validation rejects production direct mode, missing proxy credentials,
non-`openai/` aliases, missing fallback aliases, and identical primary/fallback
aliases. `OPENAI_BASE_URL` must be an HTTP(S) API root ending in `/v1`.

## Pre-launch verification

Before restarting ai-runtime:

1. Call `GET <OPENAI_BASE_URL>/models` with the router-issued bearer token and
   confirm all six aliases are visible to that token.
2. Send one minimal `POST <OPENAI_BASE_URL>/chat/completions` request to each
   alias. Verify the primary requests are billed by 1token.ai and fallback
   requests by Kimi in the proxy logs.
3. Exercise one run below the supplier-spend threshold and one run in degraded
   mode. Confirm the resulting billing events name `primary` and `fallback`
   respectively and the proxy logs show the matching aliases.
4. Disable the 1token.ai channel in a staging proxy and confirm the proxy's
   configured availability policy behaves as intended. Provider-outage
   failover must be configured and tested in the proxy; ai-runtime's
   `primary`/`fallback` selection is the platform cost-guardrail decision.
5. Rotate both upstream keys once the test is complete, then reload the proxy
   without exposing either key to ai-runtime.

Do not point `OPENAI_BASE_URL` directly at 1token.ai or Kimi in production. That
would make the other supplier unreachable because Mastra's OpenAI provider has
only one base URL and API key per process.
