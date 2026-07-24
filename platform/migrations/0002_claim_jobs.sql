CREATE OR REPLACE FUNCTION claim_next_job(worker_name text)
RETURNS TABLE (id uuid, workspace_id uuid, run_id uuid, kind text, payload jsonb, attempt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM job
    WHERE job.status = 'queued' AND job.available_at <= now()
    ORDER BY job.available_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE job
  SET status = 'running', attempt = job.attempt + 1, locked_at = now(), locked_by = worker_name, updated_at = now()
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.id, job.workspace_id, job.run_id, job.kind, job.payload, job.attempt;
END;
$$;
