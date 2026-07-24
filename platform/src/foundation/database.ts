import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface TenantTransaction {
  query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }>;
}

export class Database {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async withWorkspace<T>(workspaceId: string, operation: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const tx: TenantTransaction = { query: (sql, values) => query(client, sql, values) };
      const result = await operation(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> { await this.pool.end(); }

  async claimNextJob(workerName: string): Promise<{ id: string; workspaceId: string; runId: string | null; kind: string; payload: Record<string, unknown>; attempt: number } | undefined> {
    const result = await this.pool.query<{ id: string; workspace_id: string; run_id: string | null; kind: string; payload: Record<string, unknown>; attempt: number }>(
      'SELECT * FROM claim_next_job($1)', [workerName],
    );
    const job = result.rows[0];
    return job && { id: job.id, workspaceId: job.workspace_id, runId: job.run_id, kind: job.kind, payload: job.payload, attempt: job.attempt };
  }
}

async function query<Row extends QueryResultRow>(client: PoolClient, sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
  const result = await client.query<Row>(sql, values as unknown[] | undefined);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}
