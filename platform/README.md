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
