import { assertAuthSchema } from './auth-readiness';
import { Database } from './database';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be loaded from the actual running platform configuration.');
  const database = new Database(process.env.DATABASE_URL);
  try {
    await assertAuthSchema(database);
    console.log('Authentication database schema is ready.');
  } finally { await database.close(); }
}

void main().catch((error: unknown) => {
  // Do not print the connection URL, credentials or raw provider error.
  console.error(error instanceof Error ? error.message : 'Authentication database check failed.');
  process.exitCode = 1;
});
