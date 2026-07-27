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

For a connected runtime, set the same high-entropy value in platform
`AI_RUNTIME_EVENT_SIGNING_SECRET` and ai-runtime `EVENT_CALLBACK_SIGNING_SECRET`.
The gateway rejects unsigned runtime events. Use `pnpm issue:token` with
`ACTOR_ID`, `WORKSPACE_ID`, `WORKSPACE_ROLE`, and `AUTH_TOKEN_SECRET` to mint a
short-lived operator token for local setup; production sign-in must be supplied
by the deployment's identity provider.

## Framework direction

The platform is being prepared for a staged adoption of stable Egg 3.x. The
current Fastify gateway remains the compatible production adapter while the
domain services are separated from process lifecycle concerns. See
[`EGG_ADOPTION.md`](./EGG_ADOPTION.md) for the review, target layout, and
cutover acceptance criteria.
