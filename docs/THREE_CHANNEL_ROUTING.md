# Three-channel model routing (opt-in)

This profile preserves manual bands and existing billing exceptions. It does
not implement Auto routing, language routing, quality escalation, or automatic
cross-provider outage failover. Existing `proxy` deployments remain unchanged.

## Routes

| Band / billing provider | Runtime alias | Destination / wire model |
| --- | --- | --- |
| Eco / primary | `openai/piggy-deepseek-eco` | DeepSeek official / `deepseek-flash` |
| Eco / fallback | `openai/piggy-deepseek-eco-fallback` | DeepSeek official / `deepseek-flash` |
| Standard | `openai/piggy-glm-standard` | Z.AI international / `glm-5.3-flash` |
| Flagship | existing `AI_MODEL_FLAGSHIP` | existing private routing proxy / existing 1token GPT-6 Sol alias |

Eco fallback is a distinct **logical** alias for accounting, not an independent
provider or outage backup. Both use the same official endpoint and key. The
runtime resolves these aliases locally; do not create them in one-api.

## Configuration

Configure these on the ai-runtime host through its protected environment file:

```dotenv
AI_MODEL_ROUTING_MODE=three-channel
DEEPSEEK_API_KEY=<official-DeepSeek-API-key>
ZAI_API_KEY=<Z.AI-general-API-key>
AI_MODEL_FLAGSHIP=openai/<existing-reviewed-1token-Sol-alias>
OPENAI_BASE_URL=http://127.0.0.1:3000/v1
OPENAI_API_KEY=<existing-proxy-issued-key>
```

The loopback proxy address is an example: preserve the current deployment's
working URL. Off-host proxy connections require HTTPS. Keep the existing
storage, authentication, and callback configuration unchanged. Official API keys
are server-only; never put them in VITE variables, browsers, logs, or commits.
Do not use Z.AI Coding Plan credentials/endpoints for this application traffic.

In this profile `AI_MODEL_ECO`, `AI_MODEL_STANDARD`, and the three
`AI_MODEL_*_FALLBACK` settings are replaced by the profile's route table. Retain
their old values in the protected environment file for rollback. The Flagship
setting is required and is **not** changed automatically: verify its proxy
mapping really targets GPT-6 Sol. Missing keys fail startup; they never cause a
request to borrow another supplier's key or silently change models.

Official roots are fixed to prevent accidental cross-channel credential use:

- DeepSeek: `https://api.deepseek.com/v1`
- Z.AI: `https://api.z.ai/api/paas/v4`

The installed Mastra runtime uses an explicit OpenAI-compatible model object
for `/chat/completions`. Eco/Standard use Mastra schema prompt injection instead
of assuming the official APIs support OpenAI's native `json_schema` response
format. Local schema validation and existing semantic validation remain strict;
invalid results are not accepted as success. Flagship's native structured-output
contract is unchanged. No automatic retry to another band is introduced. Provider-specific
thinking defaults are not changed in this patch; verify latency and billable
reasoning usage before activation. Do not assume these official models accept
every OpenAI parameter or that JSON support implies identical schema support.

## Manual selection and guardrails

1. An entitled explicit choice is preserved; no task/language heuristic overrides it.
2. An explicit disallowed band returns `model_band_not_allowed`, rather than
   silently choosing another permitted band.
3. Insufficient credits for the requested band still choose **Eco / primary**
   when at least one credit remains.
4. Existing `degraded` resource status still chooses **Eco / fallback**.
5. Hard spend caps, zero credits, and invalid/expired subscriptions still pause.
6. Already-paid retries replay their recorded band/provider and do not charge again.

Important: existing guardrail code degrades at exhausted task quota, warns at
80% usage/spend, and pauses at the supplier hard spend limit. This change does
not turn the hard limit into a soft fallback threshold. Prices (1/6/20 credits)
and fixed supplier cost estimates are unchanged; this is not token-based actual
cost reconciliation. A worker-wide restart should be coordinated after draining
in-flight tasks, since model mapping changes can affect retried jobs.

## Staging acceptance before production

Use a dedicated test workspace, separate staging keys, and synthetic zh/en/es
data. These checks make paid calls; do not run automatically during startup/CI.

1. Run classification, topic proposal/assignment, all six reports, and the
   announcement workflow for the selected bands. Verify structured results,
   evidence checks and source counts, not just an HTTP 200.
2. Verify destination model and usage in each provider's dashboard. No Eco or
   Standard traffic should hit the Flagship proxy. Confirm actual 1token model.
3. With sufficient allowance, verify manual bands stay fixed. Test a one-credit
   account (primary Eco), a degraded account (fallback Eco), exhausted credits,
   hard spend cap, and a repeated already-paid job (no second debit).
4. Simulate missing credentials/429/5xx in a test environment. Confirm failures
   do not silently switch to another paid tier or expose credentials.
5. Measure latency, reasoning/output tokens, costs and failure rates. The
   official `deepseek-flash` alias currently refers to V4.1 Flash; it can change
   upstream. Revalidate when providers update aliases.

Only enable production after these pass. To roll back, restore
`AI_MODEL_ROUTING_MODE=proxy` and the previous six alias settings, then restart
ai-runtime after handling in-flight jobs. No database migration is required.

References: [DeepSeek](https://api-docs.deepseek.com/),
[Z.AI endpoint](https://docs.z.ai/api-reference/introduction),
[GLM model](https://docs.z.ai/guides/vlm/glm-5.3-flash).
