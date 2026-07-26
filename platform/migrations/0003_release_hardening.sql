-- V1 release hardening: enforce tenant policies for the application owner and
-- close the nullable uniqueness hole in usage metering.
ALTER TABLE brand_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE secret FORCE ROW LEVEL SECURITY;
ALTER TABLE connected_account FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_version FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_run FORCE ROW LEVEL SECURITY;
ALTER TABLE step_run FORCE ROW LEVEL SECURITY;
ALTER TABLE approval_request FORCE ROW LEVEL SECURITY;
ALTER TABLE run_event FORCE ROW LEVEL SECURITY;
ALTER TABLE task_event FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_event FORCE ROW LEVEL SECURITY;

-- Job claiming deliberately crosses tenants, but it is available only through
-- the worker's security-definer function. The job table itself is kept out of
-- FORCE RLS so that the function can claim the next global job.
REVOKE ALL ON FUNCTION claim_next_job(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION claim_next_job(worker_name text)
RETURNS TABLE (id uuid, workspace_id uuid, run_id uuid, kind text, payload jsonb, attempt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recover abandoned claims before selecting the next runnable job. A worker
  -- lease is deliberately finite so a process crash cannot strand a run.
  UPDATE job
     SET status = 'dead_lettered', locked_at = NULL, locked_by = NULL,
         last_error = COALESCE(last_error, 'worker lease expired'), updated_at = now()
   WHERE status = 'running'
     AND locked_at < now() - interval '5 minutes'
     AND attempt >= max_attempts;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
      FROM job
     WHERE (job.status = 'queued' AND job.available_at <= now())
        OR (job.status = 'running' AND job.locked_at < now() - interval '5 minutes' AND job.attempt < job.max_attempts)
     ORDER BY job.available_at, job.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE job
     SET status = 'running', attempt = job.attempt + 1, locked_at = now(),
         locked_by = worker_name, updated_at = now()
    FROM candidate
   WHERE job.id = candidate.id
  RETURNING job.id, job.workspace_id, job.run_id, job.kind, job.payload, job.attempt;
END;
$$;

ALTER TABLE task_event DROP CONSTRAINT task_event_run_id_step_run_id_action_type_attempt_key;
CREATE UNIQUE INDEX task_event_idempotency_idx
  ON task_event (run_id, COALESCE(step_run_id, '00000000-0000-0000-0000-000000000000'::uuid), action_type, attempt);
