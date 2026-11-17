# GLM Standard + Kimi Flagship through LiteLLM

This release adds the explicit `kimi` proxy profile. It does not overwrite
protected production environment files or run paid requests during deployment.
The old direct and 1Token profiles remain available for rollback.

| Band | Runtime wire model | Upstream |
| --- | --- | --- |
| Standard | `primary-standard` | `openai/glm-5.3-flash`, `https://api.z.ai/api/paas/v4` |
| Flagship | `primary-flagship` | `openai/kimi-k3.1-pro`, `https://api.moonshot.ai/v1` |
| Eco | unchanged | existing DeepSeek direct or LiteLLM route |

Runtime configuration after cutover:

```dotenv
AI_MODEL_ROUTING_MODE=litellm
AI_PROXY_MODEL_PROFILE=kimi
AI_PROXY_BANDS=standard,flagship
OPENAI_BASE_URL=http://127.0.0.1:4400/v1
OPENAI_API_KEY=<dedicated LiteLLM virtual key>
```

If Eco was already proxied, retain `AI_PROXY_BANDS=eco,standard,flagship`.
The candidate generator detects this; it preserves Eco's rate/version and the
existing `cost-v1` or `shadow` mode. Direct Eco still needs `DEEPSEEK_API_KEY` on
runtime. GLM and Kimi keys move to the proxy environment only. Do not use a
Coding Plan key, the LiteLLM master key as a client key, or an old 1Token key as
the Moonshot upstream key. No fallback or additional retry is configured.

## Rates and billing

`credits = ceil(valid saved operation cost USD * 1.06 / 0.01)` is unchanged.
Child calls accumulate before rounding; duplicate receipts/settlement cannot
charge twice. Cached reads and the two TTL writes replace their corresponding
ordinary input tokens; reasoning already included in completion tokens is not
added again. Only unused budget is released; independently saved work remains
billable under the existing policy.

The generator requires verified GLM/Kimi snapshots; it deliberately refuses
old GPT/Opus tariffs. It copies the numeric USD prices into both platform rates
and proxy `model_info`; it does not scrape prices or invent production rates.
For Kimi, both `cacheWrite5mUsdPerMillion` and `cacheWrite1hUsdPerMillion` are
required. All rates are decimal strings in USD per million tokens. A CNY
source requires an explicit FX snapshot and pre-converted USD numbers. Use the
international account invoice for the configured `api.moonshot.ai` endpoint.
If rates are not already correct in `platform.env`, supply a protected JSON
file containing all three verified rate objects as the second CLI argument.
Its Eco object must match the current snapshot exactly; this migration cannot
change Eco pricing.
The generator preserves optional context/output limits and provenance.
Time-varying rates for a proxied band are rejected: static `model_info` cannot
reproduce that calendar. A direct Eco calendar remains unchanged.

Kimi Chat Completions supplies total writes in
`usage.prompt_tokens_details.cache_write_tokens` and TTL splits in:

- `Msh-Usage-Cache-Write-Tokens-5m`
- `Msh-Usage-Cache-Write-Tokens-1h`

Runtime accepts these directly or with LiteLLM's `llm_provider-` prefix. It
checks both headers, all JSON totals and any JSON TTL splits for agreement.
Kimi responses must explicitly report writes (including zero) in usage or a
TTL split; stripped write metadata is not assumed to mean zero.
Malformed, partial, conflicting or positive-but-unsplit writes remain
`unknown`, entering the existing reconciliation/timeout-release flow; they
are never guessed as zero or inferred from the requested TTL. Request tracing
retains the proxy call ID without logging prompts or secrets.

References: [Kimi pricing](https://platform.kimi.com/docs/pricing/chat),
[Kimi cache fields and TTL headers](https://platform.kimi.com/docs/guide/context-caching),
[LiteLLM provider response headers](https://docs.litellm.ai/docs/proxy/response_headers),
[LiteLLM rate fields](https://docs.litellm.ai/docs/proxy/model_cost_map).
A proxy cost estimate is not an upstream invoice. Confirm the pinned image's
header forwarding, usage normalization and both TTL spend calculations in
staging before treating LiteLLM spend logs as reconciled.

## Prepare a candidate on the server

First deploy this code release with the existing environment. No new SQL
migration is needed. In the protected env files, ensure the GLM and Moonshot
keys are present in runtime or proxy (`ZAI_API_KEY` / `MOONSHOT_API_KEY`). Keep
existing LiteLLM image digests, database password, master key and salt stable.
Configure runtime's proxy root and a dedicated virtual key with access to
`primary-standard` and `primary-flagship` (also Eco if already proxied).

```bash
cd /opt/ai-marketing-agent
PIGGY_NODE="$(command -v node)"
sudo "$PIGGY_NODE" scripts/prepare-kimi-proxy.mjs /root/piggybot-glm-kimi-candidate
# If a separately reviewed full rate snapshot is needed, use instead:
# sudo "$PIGGY_NODE" scripts/prepare-kimi-proxy.mjs /root/piggybot-glm-kimi-candidate /etc/piggybot/verified-glm-kimi-rates.json
sudo "$PIGGY_NODE" scripts/litellm-preflight.mjs /root/piggybot-glm-kimi-candidate/proxy.env
```

Use a new candidate directory; the generator will not overwrite files. Files
are mode 0600 inside a 0700 directory. Do not print them into chat/logs. The
raw `deploy/litellm/config-kimi.yaml` contains rate markers and is not a live
configuration: use the rendered candidate `config.yaml`.

## Coordinated cutover

Drain queued/in-flight AI work before switching. Accepted quotes and pending
reconciliation use their old saved tariffs/model identities: finish or cancel
old work and obtain new quotes after cutover. Stop automatic task intake during
maintenance. Apply on staging first.

1. Back up `/etc/piggybot/platform.env`, `ai-runtime.env`, `litellm.env` and
   `litellm-config.yaml` to a new root-only directory. Save all four together.
2. Stop `piggybot-platform` and `piggybot-ai-runtime` after work is drained.
3. Install candidate `proxy.env` as `/etc/piggybot/litellm.env` and `config.yaml`
   as `/etc/piggybot/litellm-config.yaml`, mode 0600 and preserving the existing
   ownership expected by the deployment. Recreate the proxy with the existing
   project and volumes:

   ```bash
   sudo docker compose --env-file /etc/piggybot/litellm.env \
     -f /opt/ai-marketing-agent/deploy/litellm/compose.yaml up -d proxy
   ```

4. Check readiness and the candidate virtual key without any paid call:

   ```bash
   sudo "$PIGGY_NODE" --env-file=/root/piggybot-glm-kimi-candidate/runtime.env \
     ai-runtime/scripts/check-unified-proxy.mjs
   ```

5. Install candidate `platform.env` and `runtime.env` to the corresponding live
   env files, retaining original ownership and restrictive permissions. Restart
   runtime, check its health, then start platform. Verify:

   ```bash
   sudo systemctl restart piggybot-ai-runtime
   curl --fail --silent --show-error http://127.0.0.1:4111/internal/health
   sudo systemctl restart piggybot-platform
   curl --fail --silent --show-error http://127.0.0.1:4100/internal/ready
   ```

6. Run one small Standard and one Flagship task through the product. Confirm
   proxy aliases, actual upstream model, request trace/call ID, valid saved
   result, supplier usage and credit receipt. For a Kimi request with cache
   writes, verify both forwarded TTL headers and a known-cost receipt. Test
   repeat cache hits and the 1h TTL in staging before enabling that TTL in a
   product workflow. Do not accept HTTP 200 alone as billing acceptance.

If readiness, model access or accounting checks fail, keep task intake stopped;
restore all four backed-up configuration files as a set, recreate the proxy,
and restart both services. Reissue quotes after rollback. Never reset billing
ledgers, manually rewrite old receipt costs, or automatically replay paid work.

## Validation

Unit tests exercise routing/JSON mode, raw and prefixed TTL headers, conflicting
counts, both TTL prices, and reasoning without double counting. Built-server
smoke tests use a local proxy-shaped stub (no paid API calls). Real PostgreSQL
tests verify saved-rate recomputation, cumulative rounding, duplicate receipt
idempotence and unused-credit release. These are local integration checks, not
a claim that the currently deployed LiteLLM image/upstream has been probed.
