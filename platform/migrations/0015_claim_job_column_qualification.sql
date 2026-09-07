-- RETURNS TABLE defines PL/pgSQL variables, including `attempt`. The lease
-- recovery UPDATE in 0003 used bare `attempt`, so even an empty queue raised
-- 42702 on every claim. Use a new migration: editing 0003 would not repair
-- databases whose migration ledger already records it as applied.
CREATE OR REPLACE FUNCTION claim_next_job(worker_name text)
RETURNS TABLE (id uuid, workspace_id uuid, run_id uuid, kind text, payload jsonb, attempt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.job AS j
     SET status = 'dead_lettered', locked_at = NULL, locked_by = NULL,
         last_error = COALESCE(j.last_error, 'worker lease expired'), updated_at = now()
   WHERE j.status = 'running'
     AND j.locked_at < now() - interval '5 minutes'
     AND j.attempt >= j.max_attempts;

  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
      FROM public.job AS j
     WHERE (j.status = 'queued' AND j.available_at <= now())
        OR (j.status = 'running' AND j.locked_at < now() - interval '5 minutes' AND j.attempt < j.max_attempts)
     ORDER BY j.available_at, j.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.job AS j
     SET status = 'running', attempt = j.attempt + 1, locked_at = now(),
         locked_by = claim_next_job.worker_name, updated_at = now()
    FROM candidate
   WHERE j.id = candidate.id
  RETURNING j.id, j.workspace_id, j.run_id, j.kind, j.payload, j.attempt;
END;
$$;

-- Preserve the existing cross-tenant worker boundary; never grant this
-- SECURITY DEFINER function to arbitrary database users.
REVOKE ALL ON FUNCTION claim_next_job(text) FROM PUBLIC;
