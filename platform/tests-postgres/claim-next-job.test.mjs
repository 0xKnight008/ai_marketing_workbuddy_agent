import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import pg from 'pg';

// Deliberately separate from DATABASE_URL: never fall back to the live DB.
// CI provides a disposable PostgreSQL 16 database, not a mocked SQL adapter.
test('claim_next_job migration repairs 42702 and preserves lease semantics', async (t) => {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL must point to an empty disposable PostgreSQL database');
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const existing = await client.query("SELECT to_regclass('public.app_user') AS users, to_regclass('public.job') AS jobs");
    assert.deepEqual(existing.rows[0], { users: null, jobs: null }, 'Refusing to run against an existing platform database');

    const directory = new URL('../migrations/', import.meta.url);
    const fixName = '0015_claim_job_column_qualification.sql';
    for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql') && name < fixName).sort()) {
      await client.query(await readFile(new URL(name, directory), 'utf8'));
    }

    await t.test('pre-fix schema reproduces the production error even with no jobs', async () => {
      await client.query('SAVEPOINT broken_claim');
      await assert.rejects(client.query('SELECT * FROM claim_next_job($1)', ['test-worker']), {
        code: '42702', message: 'column reference "attempt" is ambiguous',
      });
      await client.query('ROLLBACK TO SAVEPOINT broken_claim');
      await client.query('RELEASE SAVEPOINT broken_claim');
    });

    const permissions = await client.query("SELECT proowner, proacl, prosecdef, proconfig FROM pg_proc WHERE oid = 'claim_next_job(text)'::regprocedure");
    const fix = await readFile(new URL(fixName, directory), 'utf8');
    await client.query(fix);
    await client.query(fix); // Replacing the function is safe to repeat.

    await t.test('replacement keeps the function owner, grants and security boundary', async () => {
      const after = await client.query("SELECT proowner, proacl, prosecdef, proconfig FROM pg_proc WHERE oid = 'claim_next_job(text)'::regprocedure");
      assert.deepEqual(after.rows, permissions.rows);
      assert.equal(after.rows[0].prosecdef, true);
      assert.deepEqual(after.rows[0].proconfig, ['search_path=public']);
    });

    const claim = () => client.query('SELECT * FROM claim_next_job($1)', ['test-worker']);
    const workspace = await client.query("INSERT INTO workspace (name, slug) VALUES ('Regression', 'claim-regression') RETURNING id");
    const workspaceId = workspace.rows[0].id;
    const insert = async ({ status = 'queued', attempt = 0, stale = false, future = false, lastError = null } = {}) => {
      const result = await client.query(`INSERT INTO job
        (workspace_id, kind, payload, status, attempt, max_attempts, locked_at, locked_by, available_at, last_error)
        VALUES ($1, 'regression', '{"test":true}', $2, $3, 3,
          CASE WHEN $2 = 'running' THEN now() - CASE WHEN $4 THEN interval '6 minutes' ELSE interval '1 minute' END END,
          CASE WHEN $2 = 'running' THEN 'previous-worker' END,
          now() + CASE WHEN $5 THEN interval '1 hour' ELSE interval '0 seconds' END, $6) RETURNING id`,
      [workspaceId, status, attempt, stale, future, lastError]);
      return result.rows[0].id;
    };
    const row = async (id) => (await client.query('SELECT * FROM job WHERE id = $1', [id])).rows[0];
    const scenario = async (name, run) => t.test(name, async () => {
      await client.query('SAVEPOINT scenario');
      try { await run(); } finally {
        await client.query('ROLLBACK TO SAVEPOINT scenario');
        await client.query('RELEASE SAVEPOINT scenario');
      }
    });

    await scenario('empty queue returns no job', async () => {
      assert.deepEqual((await claim()).rows, []);
    });
    await scenario('queued job is claimed once with the unchanged return contract', async () => {
      const id = await insert();
      assert.deepEqual((await claim()).rows, [{ id, workspace_id: workspaceId, run_id: null, kind: 'regression', payload: { test: true }, attempt: 1 }]);
      const job = await row(id);
      assert.equal(job.status, 'running');
      assert.equal(job.locked_by, 'test-worker');
      assert.ok(job.locked_at);
      assert.deepEqual((await claim()).rows, []);
    });
    await scenario('expired lease below the attempt limit is reclaimed', async () => {
      const id = await insert({ status: 'running', attempt: 1, stale: true });
      assert.equal((await claim()).rows[0].attempt, 2);
      const job = await row(id);
      assert.equal(job.status, 'running');
      assert.equal(job.locked_by, 'test-worker');
      assert.equal(job.attempt, 2);
    });
    await scenario('exhausted leases are dead-lettered and retain existing errors', async () => {
      const ids = await Promise.all([
        insert({ status: 'running', attempt: 3, stale: true }),
        insert({ status: 'running', attempt: 3, stale: true, lastError: 'provider failed' }),
      ]);
      assert.deepEqual((await claim()).rows, []);
      for (const [index, id] of ids.entries()) {
        const job = await row(id);
        assert.equal(job.status, 'dead_lettered');
        assert.equal(job.attempt, 3);
        assert.equal(job.locked_at, null);
        assert.equal(job.locked_by, null);
        assert.equal(job.last_error, index === 0 ? 'worker lease expired' : 'provider failed');
      }
    });
    await scenario('live leases, delayed jobs and terminal jobs are left untouched', async () => {
      const ids = await Promise.all([
        insert({ status: 'running', attempt: 3 }),
        insert({ future: true }),
        insert({ status: 'succeeded' }),
        insert({ status: 'failed' }),
        insert({ status: 'dead_lettered' }),
      ]);
      const before = await Promise.all(ids.map(row));
      assert.deepEqual((await claim()).rows, []);
      assert.deepEqual(await Promise.all(ids.map(row)), before);
    });
  } finally {
    // Includes DDL and fixtures: never leave test objects behind.
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
});
