# Worker claim failure: PostgreSQL 42702

Production logs on 2026-09-07 show `column reference "attempt" is ambiguous`
in `claim_next_job(text)`, called by Egg's `run-worker` schedule. Migration 0003
introduced a lease-recovery UPDATE whose bare `attempt` conflicts with the
function's RETURNS TABLE output variable. PostgreSQL resolves this statement
when it executes, so installing the function successfully does not test it.
Even an empty job queue fails before any job can be claimed.

Migration **0015_claim_job_column_qualification.sql** replaces the function,
qualifies column references, and preserves its return shape, lease duration,
retry limits, SECURITY DEFINER boundary and restricted execution permissions.
Historical migrations are intentionally unchanged so existing installations
receive the fix through the normal migration ledger.

## Validation

`cd platform && npm run test:postgres` requires `TEST_DATABASE_URL` for an empty,
disposable PostgreSQL database. It never falls back to `DATABASE_URL`. The test
applies the historical migrations, reproduces 42702, applies the repair, and
checks empty queues, new claims, lease recovery, exhausted retries, untouched
live/future/terminal jobs and function permissions. DDL and fixtures are rolled
back. CI runs this against PostgreSQL 16 before deployment can proceed.

## Applying to the existing server

Merging code alone does not replace the installed database function. Back up
the database, identify and pause the actual worker process, update its actual
checkout to the merged commit, and run `npm run migrate` from that checkout's
`platform` directory with its existing, correctly loaded `DATABASE_URL`.
Use the database migration owner (or an explicitly authorized migration role).
Then resume the same service and verify that the recurring 42702 log stops.
Do not change global `plpgsql.variable_conflict`, reset the database, edit
already-applied migration ledger entries, or expose environment secrets.

The observed server process ran under
`/home/ubuntu/work/ai_marketing_workbuddy_agent/platform`, with terminal output;
`piggybot-platform.service` did not exist. The checked-in deploy script assumes
`/opt/ai-marketing-agent` and that systemd service. Reconcile the actual service
manager, checkout and environment-file paths before relying on automatic
deployment; this PR does not alter or restart production services.

This stack trace is from the background worker, **not an auth HTTP request**.
It proves the queue bug, but does not establish the cause of the separate
`/api/auth/login` / `/api/auth/register` HTTP 500. Auth diagnosis still requires
the request-specific exception; annual billing and Discord reply delivery are
separate follow-up work.
