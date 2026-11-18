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

The default migration now uses the operator-approved **2026-11-18 international
USD snapshot** in `deploy/litellm/rates-glm-kimi-2026-11-18.json`. It replaces
legacy GPT/Opus identities and prices for Standard/Flagship only:

| USD per million tokens | GLM-5.3-Flash | Kimi-K3.1-Pro |
| --- | ---: | ---: |
| Input | 0.15 | 2.00 |
| Cached input | 0.03 | 0.20 |
| Output (including billable reasoning) | 0.50 | 10.00 |
| Cache write, 5m | — | 2.00 |
| Cache write, 1h | — | 4.00 |

Sources verified on 2026-11-18: [Z.AI USD pricing](https://docs.z.ai/guides/overview/pricing)
and [Kimi international pricing](https://platform.kimi.ai/docs/pricing/chat).
The international page's embedded pricing-table data provides the Kimi USD
values; its Markdown export omits that table. The CNY table on `platform.kimi.com`
is **not** converted or substituted. The upstream remains `api.moonshot.ai`.
These are saved public list-price snapshots, not a guarantee of an account's
negotiated rate or future prices. Review a new version if the supplier changes
its tariff. Legacy GPT/Opus context/output overrides are not copied to the new
models. For a different verified contract, pass a full three-band JSON snapshot
as the second CLI argument; it retains its provenance and optional provider
limits. All numeric prices must already be USD decimal strings. A CNY source
also requires an FX snapshot. Missing Kimi write prices or wrong model identities
are rejected. Existing quotes/receipts are not rewritten.

### Existing Eco time-of-day pricing

Eco's platform snapshot is copied unchanged: model aliases, version, base and
peak prices, all UTC `periods`, `validUntil`, currency and FX provenance. Expired
or malformed calendars are rejected; past periods in a still-valid calendar are
retained. A supplied full snapshot must contain an exactly matching Eco object.
The reported production calendar expires at `2026-12-31T16:00:00Z` (2027-01-01
00:00 Asia/Shanghai); renew it separately before expiry.

If Eco already uses LiteLLM, the generator reads `LITELLM_CONFIG_FILE` from the
protected proxy env (default: repository `deploy/litellm/config.yaml`) and copies
the **complete existing `primary-eco` model entry**. It does not synthesize a
static `model_info` from the base or peak price. The existing proxy DeepSeek key
is required and preserved; a stale runtime key cannot replace it. Missing,
duplicate or nonstandard Eco routes and custom global proxy settings fail for
review rather than silently discarding configuration. YAML formatting/comments
may change; parsed Eco settings remain equal. The YAML parser is a pinned
production dependency of `platform`; deploy/install platform dependencies first.

This is preservation of the existing Eco route and accounting behavior, **not
new support for a LiteLLM pricing calendar**. Eco's LiteLLM `spend` stays its
existing estimate; it must not be used as the authoritative time-of-day charge.
Platform receipts still use the saved tariff at the recorded request time and
should be reconciled with DeepSeek invoices. Standard/Flagship `model_info` is
rendered from the approved USD prices. New time-varying Standard/Flagship tariffs
remain blocked until a matching proxy calendar is implemented. Direct Eco stays
direct and keeps its calendar too.

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
keys are present in runtime or proxy (`ZAI_API_KEY` / `MOONSHOT_API_KEY`). When
recovering from the 1Token profile, use `sudoedit /etc/piggybot/litellm.env` to
add the official general-API `ZAI_API_KEY` and international `MOONSHOT_API_KEY`.
Do not rename/reuse the old GPT/Opus keys. Explicit proxy keys take precedence
over runtime copies. Do not paste keys into chat or command history. Keep
existing LiteLLM image digests, database password, master key and salt stable.
Configure runtime's proxy root and a dedicated virtual key with access to
`primary-standard` and `primary-flagship` (also Eco if already proxied).

```bash
cd /opt/ai-marketing-agent
PIGGY_NODE="$(command -v node)"
CANDIDATE="/root/piggybot-glm-kimi-$(date -u +%Y%m%dT%H%M%SZ)"
# Default: approved USD prices + unchanged existing Eco snapshot/configuration.
# Only preflight a candidate if preparation succeeds.
sudo "$PIGGY_NODE" scripts/prepare-kimi-proxy.mjs "$CANDIDATE" &&
  sudo "$PIGGY_NODE" scripts/litellm-preflight.mjs "$CANDIDATE/proxy.env"
printf 'Candidate path: %s\n' "$CANDIDATE"

# Alternative ONLY for a separately verified contract; use a new directory:
# sudo "$PIGGY_NODE" scripts/prepare-kimi-proxy.mjs "$CANDIDATE" /etc/piggybot/verified-glm-kimi-rates.json
```

Save the printed candidate path. After SSH reconnect, re-run
`PIGGY_NODE="$(command -v node)"` and set `CANDIDATE` to that exact path before
continuing. A successful preparation prints `Protected GLM/Kimi proxy candidates
prepared. Live files unchanged.` Errors now identify missing official keys,
invalid Eco configuration/calendars, or the failing file-operation stage without
printing secrets. A failed preparation is not followed by a misleading
`proxy.env` check. A partial new candidate is removed on write failure; existing
candidate directories are never overwritten.

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
   sudo "$PIGGY_NODE" --env-file="$CANDIDATE/runtime.env" \
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

Migration regression tests reproduce the legacy GPT/Opus profile with 98 Eco
periods, preserve proxy options/key and every calendar field, and execute the
real billing calculator at peak/off-peak boundaries and expiry. They also check
USD/cache-write prices, candidate permissions, no-overwrite/partial-write cleanup,
malformed YAML, duplicate Eco entries and missing official keys.

Unit tests exercise routing/JSON mode, raw and prefixed TTL headers, conflicting
counts, both TTL prices, and reasoning without double counting. Built-server
smoke tests use a local proxy-shaped stub (no paid API calls). Real PostgreSQL
tests verify saved-rate recomputation, cumulative rounding, duplicate receipt
idempotence and unused-credit release. These are local integration checks, not
a claim that the currently deployed LiteLLM image/upstream has been probed.
