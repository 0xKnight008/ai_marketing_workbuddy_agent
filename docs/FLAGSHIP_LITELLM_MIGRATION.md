> Cost-v1 update (2026-10-24): see [metering policy](AI_CREDIT_METERING.md) and [rollout](AI_CREDIT_METERING_ROLLOUT.md). Historical fixed-credit/automatic-downgrade descriptions below do not override the policy shown for a new operation. Prices, credit denominations and referral terms do not change.

# Flagship: one-api → LiteLLM

## Decision and boundaries

Replace only the Flagship gateway. Keep `AI_MODEL_ROUTING_MODE=three-channel`,
Eco → DeepSeek direct and Standard → Z.AI direct, including their existing keys,
wire models and output validation. Preserve the reviewed Flagship upstream model
and supplier; changing a gateway does not authorize choosing a different model.
The one-api client key is not an upstream credential and must not be reused.

The current runtime already uses OpenAI-compatible `/v1/chat/completions`, so
no provider SDK rewrite or Piggybot pricing change is needed. LiteLLM provides
model aliases, restricted virtual keys, an operator UI and spend visibility.
These features address operations, but cannot fix an invalid upstream key or a
provider lacking strict structured output. Verify those before switching.

Use a **separate PostgreSQL database/volume** for LiteLLM. Its key/spend tables
are not Piggybot business tables. Piggybot remains authoritative for 1/6/20-credit
charging, consent, refunds and customer history. LiteLLM costs for a custom
upstream model need verified pricing: configure `model_info.input_cost_per_token`
and `model_info.output_cost_per_token` using the supplier's actual contract before
relying on monetary budget limits. Do not set invented or zero prices for paid
traffic. A returned token count is not proof of a
supplier's cash charge. No Redis dependency is needed for this initial single
worker gateway; reassess when scaling to multiple workers/instances.

## Prepared deployment

`deploy/litellm/compose.yaml` starts only the Flagship gateway and its dedicated
DB. Host exposure is loopback `127.0.0.1:4400`, not a public admin endpoint.
It uses a fixed `primary-flagship` alias, no wildcard/other-band routes, no
fallbacks, zero proxy retries, no background paid model checks, and preserves
strict schema parameters (`drop_params: false`). Piggybot owns durable retries.
The password/salt remain stable across restarts. Do not run `down -v`.

This is an opt-in sidecar: ordinary Piggybot deployment packages these files but
does **not** start it, edit server secrets or switch production routing.
Local CI uses stubbed HTTP responses. A Docker daemon was unavailable on the
build machine, so container boot and live upstream generation remain server
acceptance steps; they are not claimed as completed.

## Configure and start in parallel with one-api

From `/opt/ai-marketing-agent`, copy the example to
`/etc/piggybot/litellm.env` with mode `0600` and fill it in securely. Select a
reviewed **database-capable LiteLLM image** and PostgreSQL **16** image; resolve
the exact release digests and set `LITELLM_IMAGE` and `LITELLM_POSTGRES_IMAGE`
(`repository@sha256:...`). Moving tags intentionally fail preflight. Generate a
different `sk-` + `openssl rand -hex 32` value for each master key and salt, and
a separate hex value for the DB password. Record the image release/version and
digests in deployment change records. Back up the volume and salt before upgrades.

Set `FLAGSHIP_UPSTREAM_BASE_URL`, `FLAGSHIP_UPSTREAM_MODEL` (with `openai/`
provider prefix) and `FLAGSHIP_UPSTREAM_API_KEY` to the actual reviewed provider,
not to the old one-api gateway. Keep direct-channel keys out of this container.

```bash
cd /opt/ai-marketing-agent
sudo node scripts/litellm-preflight.mjs /etc/piggybot/litellm.env
sudo docker compose --env-file /etc/piggybot/litellm.env -f deploy/litellm/compose.yaml config --quiet
sudo docker compose --env-file /etc/piggybot/litellm.env -f deploy/litellm/compose.yaml up -d
curl --fail --silent --show-error http://127.0.0.1:4400/health/readiness
```

Use the server's actual Node executable if `sudo node` is unavailable under nvm.
The readiness check makes no model request; `/health` does make paid model calls
and is deliberately not used as a container health check.

Access `http://127.0.0.1:4400/ui` through an SSH tunnel. Create separate production
and staging virtual keys restricted to `primary-flagship`, with deliberately
chosen supplier budget/rate limits. Store the application virtual key, not the
master key, in protected runtime configuration. DB-backed model editing is
disabled: YAML owns routing, so UI edits cannot silently add a second deployment.
Virtual-key management/spend tracking still uses the dedicated database.

## Acceptance and activation

1. Copy the runtime env into a protected candidate file. Change only
   `OPENAI_BASE_URL=http://127.0.0.1:4400/v1`, `OPENAI_API_KEY=<virtual key>` and
   `AI_MODEL_FLAGSHIP=openai/primary-flagship`. Keep all Eco/Standard values and
   `AI_MODEL_ROUTING_MODE=three-channel`. Preserve callback/storage/auth values.
2. Run the read-only probe against the candidate env. It checks readiness and
   authorized alias visibility, without generating text:

   ```bash
   cd /opt/ai-marketing-agent/ai-runtime
   NODE_BIN="$(command -v node)"
   sudo "$NODE_BIN" --env-file=/etc/piggybot/ai-runtime-litellm-candidate.env scripts/check-flagship-proxy.mjs
   ```

3. In staging, repeat with `--generate` for a small **paid** structured-output
   probe. Validate a full Flagship workflow in en/zh/es, actual model/token
   receipts and latency. Inject a bad key in staging; verify the failed task
   refunds exactly 20 credits once. Repeated callbacks must not add credits.
   Confirm Eco and Standard still appear only in their direct provider logs.
4. Drain in-flight work, back up protected production env, apply the three
   reviewed Flagship settings and restart `piggybot-ai-runtime`. Retain one-api
   and its old configuration for rollback until live acceptance is complete.
   Do not run a newly paid workflow automatically as part of deployment.
5. Confirm platform/runtime health, actual run model and resulting credit ledger.
   A healthy gateway and visible model list alone do not prove upstream generation.

Rollback: restore the backed-up Flagship URL/key/model settings and restart the
runtime after draining. The old one-api key was previously rejected with 401;
rollback needs a valid old gateway key. Eco/Standard settings remain unchanged.

## Primary references

- [Docker quickstart and separate DB](https://docs.litellm.ai/docs/proxy/docker_quick_start)
- [Aliases, environment secrets and config authority](https://docs.litellm.ai/docs/proxy/configs)
- [Virtual keys and model restrictions](https://docs.litellm.ai/docs/proxy/virtual_keys)
- [Non-generating readiness probes vs paid model health](https://docs.litellm.ai/docs/proxy/health)
- [Custom model pricing](https://docs.litellm.ai/docs/proxy/custom_pricing)
- [Retry and fallback semantics](https://docs.litellm.ai/docs/proxy/reliability)
