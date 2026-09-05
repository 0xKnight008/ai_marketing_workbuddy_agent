# Pre-release fixes — September 2026

## Deployment

PRs #35–37 stopped before rebuilding containers: the SSH deployment account could not read `/etc/piggybot/platform.env`. The script now accepts files readable through an existing non-interactive sudo grant and reads the platform environment without printing secrets. It does not change permissions, invent credentials, or run npm as root. The workflow checks all three environment paths **before** extracting over application files and aborts if that check fails.

Operator prerequisites remain: provision real platform, AI-runtime, and public-API configuration; ensure the deployment account has the required narrowly scoped sudo permissions; verify Node 22+, application directory write access, database backup access, and systemd working directories. Do not fix secret access with world-readable permissions or empty placeholder files. A missing file still requires server provisioning. Do not re-run the setup guide's `install /dev/null` commands over existing secrets.

Before merging/deploying, inspect file metadata and access (never secret contents):

```sh
id
sudo -n stat -c '%U:%G %a %n' /etc/piggybot /etc/piggybot/platform.env /etc/piggybot/ai-runtime.env /etc/piggybot/public-api.env
bash scripts/deploy-production.sh --check
```

The existing systemd units must reference the deployed `/opt/ai-marketing-agent` tree (or use a consistently configured alternative); older documentation shows `/srv/piggybot/current`. This PR does not move or restart live services.

## Billing

Inactive, canceled, unpaid, incomplete, unknown, and expired-trial subscriptions cannot create runs or call AI/publishing suppliers. Payment grace retains human approval, but never overrides a hard spending cap. Active subscriptions, valid trials, and explicit manual entitlements retain access. Workers check again at execution, covering cancellation after enqueueing.

## Pipelines

Starting a supported announcement pipeline publishes its immutable version and queues a durable run in the same tenant transaction. Repeated activation uses a stable per-version key, preventing duplicate runs. The response includes the actual run ID/status. Selected account IDs are resolved to tenant-owned external IDs, capabilities and runtime platform support are validated, and the configured brief/tone/language are passed to the worker. Publishing requires human approval. The initial workflow accepts up to five destinations, including under Eco fallback.

Analytics reports, comment monitoring, and recurring schedules are **not implemented** in the current execution engine. Their template cards are marked unavailable, readiness rejects their saved definitions, and both raw run creation and the worker reject unsupported workflows. They are not silently executed as announcements. The announcement builder is a single-run workflow, not a general-purpose automation compiler.

## Authentication and navigation

`/login` and `/register` expose the existing email forms; the marketing navigation explicitly names sign-in/registration. Authentication return URLs are parsed and checked for same-origin navigation. Malformed/expired stored sessions are discarded; a checkout 401 reauthenticates while preserving locale, selected plan, and referral. Permission errors do not trigger login loops. The dashboard waits for identity verification and fails closed on errors. Customer navigation no longer links to internal admin; its separate backend authorization is unchanged.

## Release verification

Regression suites cover deployment preflight, redirect/expiry/checkout helpers, subscription projections, worker supplier blocking, pipeline readiness, and activation retry idempotency. Run platform and AI-runtime suites, gateway route tests, frontend typecheck/build, and `npm run test:ui` in `platform` before merging. After a successful deployment, verify `/login`, `/register`, signup/login, checkout, and an approval-first announcement run against configured services. Local mocked tests do not replace database/provider end-to-end checks.
