# Production TS runtime via egg-scripts

## Background

`egg-scripts start` (production mode) does not load `.ts` files unless
`EGG_TYPESCRIPT=true` is set in the environment. The `egg.typescript` field
in `package.json` only affects `egg-bin dev`, not `egg-scripts start`. A
pure-TS project with `noEmit: true` will silently degrade to an empty
shell egg:

- `config.default.ts` and `config.prod.ts` are never loaded, so the port
  falls back to the built-in `7001`.
- Routes and controllers are not registered.
- If another process already holds `7001`, the worker dies with
  `EADDRINUSE` and systemd enters a tight restart loop.

This is by design: the official recommendation is to compile TS to JS
before running `egg-scripts`. The environment variables below are a
transitional workaround until the build step is in place.

## Required environment variables

| Variable | Purpose |
|----------|---------|
| `EGG_TYPESCRIPT=true` | Allow egg-core loader to accept `.ts` files |
| `NODE_OPTIONS=--require ts-node/register` | Register ts-node in the Node process |
| `TS_NODE_TRANSPILE_ONLY=true` | Skip type checking at runtime (faster, lower memory) |

Type checking is enforced separately by `tsc --noEmit` in the deploy
pipeline; do not rely on ts-node for it.

## Dependency requirements

`ts-node` and `typescript` must be listed in `platform/package.json`
under `dependencies` (not `devDependencies`). If they are only
transitive deps of `egg-bin`, then `npm ci --production` removes them
and `NODE_OPTIONS=--require ts-node/register` fails at startup.

## Port configuration

Set `PORT=4100` for production and `PORT=4200` for staging in
`/etc/piggybot/platform.env` and `/etc/piggybot-staging/platform.env`
respectively (or inline in the unit file). Do not rely on the built-in
7001 default.

## Long-term recommendation

Compile TS to JS (`tsc` with `noEmit: false`) in CI, then ship only the
compiled output and let `egg-scripts` load plain JS. This removes the
ts-node runtime dependency entirely and avoids the startup and memory
overhead.

## Verification

    curl -fsS http://127.0.0.1:4100/internal/ready
    # expected: {"ok":true,"service":"gateway","authSchema":"ready"}

    curl -fsS http://127.0.0.1:4200/internal/ready
    # expected: {"ok":true,"service":"gateway","authSchema":"ready"}

    sudo ss -ltnp | grep -E ':(4100|4200|7001)\b'
    # 4100 -> prod, 4200 -> staging, 7001 must be absent

## Staging access

`staging.piggybot.me` is behind Cloudflare Access. External probes must
include `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers, or run
from the host against `127.0.0.1:4200`. `scripts/staging-acceptance.mjs`
reads these from the environment automatically.
