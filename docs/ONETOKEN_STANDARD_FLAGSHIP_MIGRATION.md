# Standard GPT / Flagship Opus migration

The `onetoken` profile routes `primary-standard` to 1Token `gpt-6-sol` and `primary-flagship` to 1Token `claude-opus-5-5`. Eco remains the existing DeepSeek model. The proxy has separate upstream keys for the two 1Token models. Z.AI is removed from active Platform, Runtime and proxy environments, with no automatic fallback to it. Historical protected backups and audit records remain intact; old supplier keys are not revoked at the supplier account.

Operator-confirmed USD prices per million tokens:

| Band | Input | Cache read | Output | Cache write 5m | Cache write 1h |
|---|---:|---:|---:|---:|---:|
| Standard | 2 | 0.20 | 10 | — | — |
| Flagship | 4 | 0.20 | 20 | 5 | 8 |

Keep `AI_METERING_MODE=shadow`: customer credits remain the existing per-step rates. Eco's complete rate object, including calendar and FX snapshot, is copied unchanged. New Standard/Flagship operations use new rate versions and model identities; historical operations keep their immutable rate snapshots.

The new Runtime records cache-write TTL counts in its durable JSON receipts. Platform independently recomputes the receipt cost, storing the resulting cost in the existing SQL ledger. No SQL migration is needed. Cache writes replace ordinary input cost for those tokens; they are not added twice. Missing TTL detail or unverified write pricing leaves usage unknown. Budgeting conservatively allows the highest verified input/write rate. This does not add explicit cache-control requests to prompts.

The Runtime candidate sets `AI_PROXY_MODEL_PROFILE=onetoken`. This enables JSON-object mode for Opus with prompt schema injection and local validation. A real minimal 1Token probe accepted JSON-object output but rejected the old strict JSON-schema request with HTTP 400. Eco and Standard keep their existing JSON-object behavior.

## Prepare

First deploy this change's Platform and Runtime code. The Runtime `/internal/health` must return `cacheWriteMetering: true`. The Platform metering preflight rejects a cache-write tariff against an old Runtime.

Wait for active/queued work to finish before switching aliases: old accepted operations carry old model/rate snapshots. Keep a root-only backup of active env files, proxy YAML and the deployed code. The service's usual internal-token and virtual-key permissions remain unchanged.

Use `sudoedit /etc/piggybot/litellm.env` to add `OPUS_UPSTREAM_API_KEY` with the new Opus key. Keep the old `FLAGSHIP_UPSTREAM_API_KEY` and `FLAGSHIP_UPSTREAM_MODEL=openai/gpt-6-sol` until candidate generation: they supply the new Standard channel. Do not paste keys into shell commands, PRs or logs.

```bash
cd /opt/ai-marketing-agent
NODE_BIN="$(command -v node)"
CANDIDATE_DIR="/etc/piggybot/candidate-onetoken-$(date -u +%Y%m%dT%H%M%SZ)"
sudo "$NODE_BIN" scripts/prepare-onetoken-proxy.mjs "$CANDIDATE_DIR"
sudo "$NODE_BIN" scripts/litellm-preflight.mjs "$CANDIDATE_DIR/proxy.env"
```

Candidate preparation is local only, refuses to overwrite an existing directory, and does not alter live config. The generated proxy environment moves the old GPT key to `STANDARD_UPSTREAM_API_KEY`, installs Opus into `FLAGSHIP_UPSTREAM_API_KEY`, removes temporary `OPUS_UPSTREAM_API_KEY` and Z.AI keys, and preserves the virtual key, salt, database credentials and pinned images. Re-running against this profile preserves the separated keys. The old `prepare-unified-proxy.mjs` refuses the new profile to prevent restoring Z.AI accidentally.

## Cut over

Validate each upstream model using minimal synthetic JSON requests before installing candidates. Model-list access alone does not establish generation/JSON compatibility. Check that the active router contains exactly one deployment per alias, including any dashboard/database deployments; do not delete historical request/audit logs.

```bash
sudo systemctl stop piggybot-platform
sudo install -m 0600 "$CANDIDATE_DIR/config.yaml" /etc/piggybot/litellm-config.yaml
sudo install -m 0600 "$CANDIDATE_DIR/proxy.env" /etc/piggybot/litellm.env
sudo docker compose --env-file /etc/piggybot/litellm.env -f deploy/litellm/compose.yaml config --quiet
sudo docker compose --env-file /etc/piggybot/litellm.env -f deploy/litellm/compose.yaml up -d --no-deps --force-recreate --wait --wait-timeout 180 proxy
sudo "$NODE_BIN" --env-file="$CANDIDATE_DIR/runtime.env" ai-runtime/scripts/check-unified-proxy.mjs
sudo install -m 0600 "$CANDIDATE_DIR/platform.env" /etc/piggybot/platform.env
sudo install -m 0600 "$CANDIDATE_DIR/runtime.env" /etc/piggybot/ai-runtime.env
sudo systemctl restart piggybot-ai-runtime
sudo systemctl start piggybot-platform
```

Stop on any error and restore the protected pre-cutover files if readiness cannot be established. Run the Platform metering preflight after Runtime startup, inspect running process settings without printing secrets, and verify new task traces show the selected aliases and actual upstream models. Check both supplier billing and proxy estimates; the existing shadow mode is not permission to enable cost-v1.

## Rollback

Drain work, stop Platform, restore all three env files and proxy YAML from the same backup, recreate only the proxy container, restart Runtime and start Platform. Restore old source/build files as well if the code release itself needs rollback. Do not clear receipts, refunds, tasks, the LiteLLM database or its persistent volume.
