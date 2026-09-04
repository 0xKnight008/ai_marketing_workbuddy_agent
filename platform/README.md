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

The migration creates a tenant-scoped Postgres schema. The application must set `app.workspace_id` inside every tenant transaction. The one explicit exception is `Database.withAdmin`, which is limited to intentionally global directory/support tables and does not bypass RLS; admin access to jobs, billing, audit, and referral records still opens one `withWorkspace` transaction per tenant.

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

## Guided pipeline workspace

`/app` uses the hybrid template-to-pipeline flow: an operator can start from a
standard template or a written outcome, configure the draft, select connected
Zernio accounts, review the approval guardrail, run a readiness check, and then
activate it. Readiness checks never publish or perform an external action.

The gateway exposes the tenant-scoped building blocks at:

- `GET /api/pipeline-templates`
- `GET|POST /api/pipelines`
- `PATCH /api/pipelines/:pipelineId`
- `POST /api/pipelines/:pipelineId/test`
- `POST /api/pipelines/:pipelineId/activate`
- `GET /api/zernio/accounts`

Draft edits create immutable workflow versions, while existing published
workflows remain visible in the pipeline shelf. Apply
`migrations/0013_connected_account_platform.sql` before deploying this UI so
connected accounts include their platform and can be selected in context.

## Platform admin console

`/app/admin` is the back-office operations view. Every request requires two
independent factors: a valid short-lived owner/admin Bearer token and the
high-entropy `BILLING_ADMIN_TOKEN` header. The page keeps the admin secret only
in component memory; never embed it in a Vite variable, checked-in file, URL,
browser storage, or shared screenshot.

The console provides:

- workspace search with plan, current-month usage, guardrail, and subscription status;
- audited plan changes and AI-credit grants;
- support-ticket status transitions (`new`, `replied`, `closed`);
- dead-letter job replay with attempt/lease reset and run revival;
- referral attribution/credit review plus pending void or issued-credit reversal.

Apply `migrations/0012_admin_console.sql` before using these views. Admin list
and mutation responses set `Cache-Control: no-store`; all mutations also write
an `admin.*` event to the affected workspace audit trail.
