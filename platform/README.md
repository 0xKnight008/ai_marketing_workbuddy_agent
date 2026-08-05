# Piggybot platform services

This workspace contains the platform foundation and service boundaries. It is deliberately separate from the public Vite site and the Mastra AI runtime.

Service ownership:

- `gateway`: user-facing APIs, identity, workspace context, and policy snapshots.
- `run-service`: durable workflow state, approvals, events, jobs, audit, and usage facts.
- `connector-service`: encrypted credentials, connected-account lifecycle, and deterministic external actions.
- `ai-runtime`: the existing Mastra runtime, invoked only by run-service.

## Local foundation

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install --frozen-lockfile=false
pnpm migrate
pnpm test
```

The migration creates a tenant-scoped Postgres schema. The application must set `app.workspace_id` inside every tenant transaction; direct, unscoped queries are intentionally not part of the repository API.

`pnpm migrate` uses Sequelize and Umzug to apply the versioned schema files and
record their state in `schema_migration`. It deliberately does not call
`sequelize.sync()` in production: versioned migrations preserve the RLS,
Postgres enum, index, and function definitions that the platform requires.

For a connected runtime, set the same high-entropy value in platform
`AI_RUNTIME_EVENT_SIGNING_SECRET` and ai-runtime `EVENT_CALLBACK_SIGNING_SECRET`.
The gateway rejects unsigned runtime events. Use `pnpm issue:token` with
`ACTOR_ID`, `WORKSPACE_ID`, `WORKSPACE_ROLE`, and `AUTH_TOKEN_SECRET` to mint a
short-lived operator token for local setup; production sign-in must be supplied
by the deployment's identity provider.

## Egg runtime

The primary HTTP runtime is stable Egg 3.x. `pnpm dev` starts Egg locally and
`pnpm start` uses `egg-scripts` for production. Egg owns route loading,
middleware, lifecycle-managed resources, and the bounded run-worker schedule.
The Postgres claim function remains the cross-machine work lock.

The legacy Fastify entrypoint is retained only as an explicit rollback adapter
(`pnpm dev:legacy-gateway`); it is not used by the production scripts. See
[`EGG_ADOPTION.md`](./EGG_ADOPTION.md) for the runtime boundaries and rollout
requirements.
