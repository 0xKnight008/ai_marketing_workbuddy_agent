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
| Flagship | `openai/piggy-kimi-flagship` | Moonshot official / `kimi-k3.1-pro` |

Eco fallback is a distinct **logical** alias for accounting, not an independent
provider or outage backup. Both use the same official endpoint and key. The
runtime resolves these aliases locally; do not create them in one-api.

## Configuration

Configure these on the ai-runtime host through its protected environment file:

```dotenv
AI_MODEL_ROUTING_MODE=three-channel
DEEPSEEK_API_KEY=<official-DeepSeek-API-key>
ZAI_API_KEY=<Z.AI-general-API-key>
MOONSHOT_API_KEY=<Moonshot-official-API-key>
```

All three bands resolve locally to their supplier's official OpenAI-compatible
endpoint. No routing proxy (`OPENAI_BASE_URL` / `OPENAI_API_KEY`) is used in
this profile. Keep the existing storage, authentication, and callback
configuration unchanged. Official API keys are server-only; never put them in
VITE variables, browsers, logs, or commits. Do not use Z.AI Coding Plan
credentials/endpoints for this application traffic.

In this profile `AI_MODEL_ECO`, `AI_MODEL_STANDARD`, `AI_MODEL_FLAGSHIP`, and
the three `AI_MODEL_*_FALLBACK` settings are replaced by the profile's route
table. Retain their old values and the proxy settings in the protected
environment file for rollback to `proxy` mode. Missing keys fail startup; they
never cause a request to borrow another supplier's key or silently change models.

Official roots are fixed to prevent accidental cross-channel credential use:

- DeepSeek: `https://api.deepseek.com/v1`
- Z.AI: `https://api.z.ai/api/paas/v4`
- Moonshot: `https://api.moonshot.ai/v1`

The installed Mastra runtime uses an explicit OpenAI-compatible model object
for `/chat/completions`. All three official channels use Mastra schema prompt
injection with `response_format: {"type":"json_object"}`; none of them relies
on OpenAI's native `json_schema` response format. Local schema validation and
existing semantic validation remain strict; invalid results are not accepted as
success. No automatic retry to another band is introduced.

Moonshot K3 series constraints (verified against the official parameter
reference): `temperature`, `top_p`, `n`, `presence_penalty` and
`frequency_penalty` are server-fixed and any explicit other value returns
`invalid_request_error`; the transport strips them for `kimi-k3.1-pro`.
`kimi-k3.1-pro` always runs in thinking mode with `reasoning_effort` defaulting
to `max`; reasoning tokens are billable, so measure latency and reasoning-token
cost in staging before activation. Do not assume these official models accept
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
2. Verify destination model and usage in each provider's dashboard. All three
   bands must show their own official channel: DeepSeek, Z.AI, Moonshot. No
   runtime traffic should hit the old routing proxy. Confirm the returned wire
   models are `deepseek-flash`, `glm-5.3-flash`, and `kimi-k3.1-pro`.
3. With sufficient allowance, verify manual bands stay fixed. Test a one-credit
   account (primary Eco), a degraded account (fallback Eco), exhausted credits,
   hard spend cap, and a repeated already-paid job (no second debit).
4. Simulate missing credentials/429/5xx in a test environment. Confirm failures
   do not silently switch to another paid tier or expose credentials.
5. Measure latency, reasoning/output tokens, costs and failure rates. The
   official `deepseek-flash` alias currently refers to V4.1 Flash; it can change
   upstream. `kimi-k3.1-pro` always returns `reasoning_content` and bills
   reasoning tokens, so include them in the cost check. Revalidate when
   providers update aliases.
6. Run the credential-safe probe before and after cutover: `node
   ai-runtime/scripts/check-flagship-direct.mjs` (read-only) and, once,
   `--generate` for a small paid structured-output probe.

Only enable production after these pass. To roll back, restore
`AI_MODEL_ROUTING_MODE=proxy` and the previous six alias settings in the
protected environment file, remove the three-channel-only `MOONSHOT_API_KEY`,
then restart ai-runtime after handling in-flight jobs. No database migration is
required.

References: [DeepSeek](https://api-docs.deepseek.com/),
[Z.AI endpoint](https://docs.z.ai/api-reference/introduction),
[GLM model](https://docs.z.ai/guides/vlm/glm-5.3-flash),
[Moonshot Kimi API](https://platform.kimi.ai/docs/get-your-api-key.md),
[Kimi K3.1 Pro JSON mode](https://platform.kimi.ai/docs/guide/use-json-mode-feature-of-kimi-api.md).
