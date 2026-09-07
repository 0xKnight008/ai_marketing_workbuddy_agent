import type { Database } from './database';

/** Read-only check against the same database/role used by auth, not a ledger
 * entry that may describe a different database or an incomplete migration. */
export async function assertAuthSchema(database: Pick<Database, 'withAdmin'>): Promise<void> {
  try {
    await database.withAdmin(async (tx) => {
      await tx.query("SET LOCAL statement_timeout = '5s'");
      await tx.query('SELECT id, email, display_name, password_hash, password_updated_at FROM app_user LIMIT 0');
      await tx.query('SELECT id, name, slug FROM workspace LIMIT 0');
      await tx.query('SELECT workspace_id, user_id, role, created_at FROM workspace_membership LIMIT 0');
      await tx.query('SELECT workspace_id, plan, subscription_status FROM workspace_billing LIMIT 0');
      await tx.query('SELECT workspace_id, actor_id, event_type, payload FROM audit_event LIMIT 0');
    });
  } catch (cause) {
    throw new Error('Authentication database is not ready. Apply pending platform migrations to the configured DATABASE_URL (including 0013_email_password_auth.sql), then retry. Do not recreate user tables.', { cause });
  }
}
