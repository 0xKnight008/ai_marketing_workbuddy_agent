# Egg adoption review and migration plan

## Decision

Keep the current Fastify gateway as the production adapter for this release,
but make the platform services ready for a staged migration to **stable Egg
3.x**. Egg Core's v4 documentation is currently labelled beta, so it should
not be adopted as the first production framework change. Do not run Fastify
and Egg handlers for the same public route without an explicit routing split.

This is an architectural migration, not a replacement of the platform's
security model. Tenant context, RLS, signed AI-runtime events, approval gates,
and the Postgres-backed job claim remain authoritative regardless of the HTTP
framework.

## Review findings

| Area | Current state | Improvement applied | Egg destination |
| --- | --- | --- | --- |
| Application configuration | Gateway and worker independently parsed `process.env`. | Shared, typed `foundation/platform-config.ts` parses configuration at the executable boundary. | `config/config.default.ts` plus deployment-specific config. |
| Gateway | One entrypoint currently owns parsing, auth, HMAC verification, provider credentials, and routes. | Retained for API compatibility; configuration is separated. | Thin `app/controller/*` handlers, `app/middleware/*`, and `app/service/*`. |
| Durable work | A module-level infinite loop was coupled to its clients and process signals. | `RunWorker` is a bounded, dependency-injected service with `runOne()` and `drain()`. | `app/schedule/run-worker.ts` invokes `drain()`; a separate worker process remains optional. |
| Multi-node execution | A scheduler alone cannot prevent duplicate work across machines. | No relaxation: `claim_next_job` is still the global lock and lease recovery mechanism. | Every Egg worker may schedule safely only because the database claim is atomic. |
| Lifecycle | Database construction/closure is executable-local. | Dependencies are now explicit for the worker. | An Egg `app.ts` boot class owns the shared database and closes it in `beforeClose`. |

## Target layout

```text
app/
  controller/       # HTTP-only: validate request, choose status, serialize response
  service/          # Run, approval, connection, usage, and audit orchestration
  middleware/       # bearer actor, runtime HMAC, correlation ID, public errors
  extend/application.ts # typed Database and platform service accessors
  schedule/         # bounded RunWorker.drain(batchSize)
  router.ts
config/
  config.default.ts # non-secret defaults
  plugin.ts         # security, CORS, validation/logging plugins
app.ts              # Boot lifecycle; initialize and close shared resources
```

The existing framework-neutral code under `src/` is intentionally retained as
the domain/service layer. Controllers must not gain SQL or provider calls.

## Route migration order

1. Move `/internal/health` and read-only audit/usage endpoints first.
2. Move authenticated run creation and approval decisions, preserving their
   existing request/response contracts and permission checks.
3. Move Zernio OAuth and account sync with a raw-body-safe runtime event
   endpoint kept separate from browser-facing OAuth routes.
4. Cut traffic over only after contract tests cover every route; then retire
   the Fastify entrypoint in a dedicated change.

## Egg-specific guardrails

- Treat controllers as protocol adapters only; call existing run and connector
  services for every business operation.
- Use Egg's security middleware with an explicit allowlist. Do not globally
  disable CSRF or security headers merely to make OAuth work; isolate the
  callback route and document the exception.
- Keep AI-runtime HMAC verification over the exact raw JSON bytes. Any Egg
  body-parser configuration must preserve those bytes before parsing.
- Egg schedule workers run once per machine, not once globally. Always call
  the Postgres claim function and cap `RunWorker.drain()` with
  `WORKER_BATCH_SIZE`.
- Use lifecycle hooks only to initialize/close clients. Never run a long-lived
  polling loop from an Egg lifecycle hook.

## Acceptance criteria for the framework cutover

- Existing gateway contract tests pass unchanged against the Egg application.
- A signed runtime event is verified using original bytes, rejected on an
  altered signature, and is idempotent.
- Zernio OAuth callback, sync, approval decision, usage, and audit endpoints
  preserve their tenant and permission checks.
- Two scheduler instances cannot execute the same job; an expired lease is
  reclaimed by the database function.
- Graceful shutdown stops accepting requests, waits for in-flight work, and
  closes the database pool once.
