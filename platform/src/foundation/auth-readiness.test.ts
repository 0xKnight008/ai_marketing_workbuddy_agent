import assert from 'node:assert/strict';
import test from 'node:test';

import { assertAuthSchema } from './auth-readiness';
import type { Database, TenantTransaction } from './database';

test('auth readiness checks the actual schema without reading user data or mutating it', async () => {
  const queries: string[] = [];
  const database = {
    withAdmin: async (operation: (tx: TenantTransaction) => Promise<void>) => operation({
      query: async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 }; },
    }),
  } as Pick<Database, 'withAdmin'>;
  await assertAuthSchema(database);
  assert.equal(queries.length, 6);
  assert.equal(queries[0], "SET LOCAL statement_timeout = '5s'");
  assert.match(queries[1]!, /password_hash, password_updated_at FROM app_user LIMIT 0$/);
  assert.ok(queries.slice(1).every((sql) => sql.startsWith('SELECT ') && sql.endsWith('LIMIT 0')));
});

test('missing auth columns fail readiness with a migration instruction, not a healthy response', async () => {
  const cause = Object.assign(new Error('column "password_hash" does not exist'), { code: '42703' });
  const database = { withAdmin: async () => { throw cause; } } as unknown as Pick<Database, 'withAdmin'>;
  await assert.rejects(assertAuthSchema(database), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /0013_email_password_auth.sql/);
    assert.equal(error.cause, cause);
    return true;
  });
});

test('database connectivity and permission failures also fail closed', async () => {
  for (const code of ['ECONNREFUSED', '42501', '28P01']) {
    const database = { withAdmin: async () => { throw Object.assign(new Error('private-provider-detail'), { code }); } } as unknown as Pick<Database, 'withAdmin'>;
    await assert.rejects(assertAuthSchema(database), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /not ready/);
      assert.doesNotMatch(error.message, /private-provider-detail/);
      return true;
    });
  }
});
