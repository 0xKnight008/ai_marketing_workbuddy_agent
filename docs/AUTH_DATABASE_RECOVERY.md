# Login/register HTTP 500: missing authentication migration

## Confirmed cause

The 2026-09-07 request logs show PostgreSQL **42703** for both
`POST /api/auth/login` and `POST /api/auth/register`: the connected database's
`app_user` table has no `password_hash`. The main branch already contains
`0013_email_password_auth.sql`, which adds `password_hash` and
`password_updated_at`. Updating frontend/backend code without applying that
migration leaves both auth routes broken. If the migration ledger says 0013
was applied but the fields are absent, investigate the database/schema/role
mismatch or schema drift instead of modifying the ledger blindly.

The worker's **42702** (`attempt` is ambiguous in `claim_next_job`) is a separate
confirmed bug, repaired by migration 0015 in PR #39.

## Existing-server recovery

The observed live checkout is
`/home/ubuntu/work/ai_marketing_workbuddy_agent/platform` and runs under an
interactive terminal. `piggybot-platform.service` does not exist on this server.
Do not assume that updating `/opt/ai-marketing-agent` or restarting that service
will update this process.

1. Back up the actual platform database and choose a maintenance window.
2. Pause the actual running platform/worker using its current process manager.
3. Update its checkout to the merged main, preserving local configuration and
   uncommitted changes. Load its existing trusted environment configuration in
   the maintenance shell. Use the same target database and an authorized
   migration-owner role. Never paste secrets into chat or print DATABASE_URL.
4. From the live platform directory, run:

   ```bash
   cd /home/ubuntu/work/ai_marketing_workbuddy_agent/platform
   : "${DATABASE_URL:?Load the existing platform database configuration first}"
   npm run migrate
   npm run db:check
   ```

   Stop if migration fails. Do not drop/recreate tables, delete migration
   history, synthesize replacement credentials or run against a guessed DB.
5. Resume the platform using its actual start mechanism. Verify:

   ```bash
   curl --fail --max-time 10 http://127.0.0.1:4100/internal/ready
   ```

   This must return `authSchema: ready`. Then verify register, sign out, login
   and identity lookup with an operator-controlled test account. Never use a
   real customer's credentials for diagnostics. Existing activation-only
   accounts still need to set a password through their authorized session.

If 0013 is pending, applying the normal migration chain supplies the missing
columns; this PR does not add a duplicate password migration or change hashes.
Applying main including PR #39 also repairs worker claiming via 0015.

## Prevention in this PR

- Egg and the legacy gateway verify the actual auth schema before accepting
  traffic (DB-free Egg unit tests are the sole explicit exception).
- `/internal/health` stays a liveness check; `/internal/ready` verifies auth
  schema and returns a sanitized 503 on failure. Keep `/internal/` private in
  the reverse proxy, as documented in OCI_DEPLOYMENT.md.
- `npm run db:check` is a read-only CLI check using the configured DATABASE_URL.
  It queries zero rows, never migrates automatically, and reports no secrets.
- Deployment checks schema after migration and polls readiness, not liveness.
- A required reusable CI job uses disposable PostgreSQL 16: reproduce missing
  columns on the pre-0013 schema, apply migrations, then exercise the real
  register/login/me/password-hash path without external email or payment calls.

This improves release checks; it does not provision missing environment files,
create production systemd units, migrate production remotely or confirm live
recovery. Annual Stripe pricing and Discord-to-email delivery remain separate
changes.
