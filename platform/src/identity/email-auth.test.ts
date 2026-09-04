import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActorContext } from '../contracts/domain';
import type { Database, TenantTransaction } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { hashPassword } from './password';
import { EmailAuthService } from './email-auth';
import { verifyAccessToken } from './token';

const secret = 'test-email-auth-secret-must-be-at-least-32-bytes';
const userId = '00000000-0000-4000-8000-000000000011';
const workspaceId = '00000000-0000-4000-8000-000000000022';
const actor: ActorContext = { actorId: userId, workspaceId, role: 'owner' };

function config(): GatewayConfig {
  return { AUTH_TOKEN_SECRET: secret, AUTH_SESSION_TTL_SECONDS: 3_600 } as GatewayConfig;
}

/** In-memory app_user/workspace/membership triple standing in for Postgres. */
function fakeDatabase(seed?: { email: string; passwordHash: string | null }) {
  const users = new Map<string, { id: string; displayName: string; passwordHash: string | null }>();
  if (seed) users.set(seed.email, { id: userId, displayName: 'Seed', passwordHash: seed.passwordHash });
  const inserts: string[] = [];
  const database = {
    async withAdmin(operation: (tx: TenantTransaction) => Promise<unknown>) {
      const tx = {
        async query(sql: string, values?: readonly unknown[]) {
          if (sql.startsWith('SELECT id FROM app_user') || sql.includes('password_hash AS "passwordHash"')) {
            const row = users.get(values?.[0] as string);
            return { rows: row ? [{ id: row.id, passwordHash: row.passwordHash }] : [], rowCount: row ? 1 : 0 };
          }
          if (sql.startsWith('INSERT INTO app_user')) {
            users.set(values?.[0] as string, { id: userId, displayName: values?.[1] as string, passwordHash: values?.[2] as string });
            return { rows: [{ id: userId }], rowCount: 1 };
          }
          if (sql.startsWith('INSERT INTO workspace_membership')) { inserts.push('membership'); return { rows: [], rowCount: 1 }; }
          if (sql.startsWith('INSERT INTO workspace')) return { rows: [{ id: workspaceId }], rowCount: 1 };
          if (sql.includes('FROM workspace_membership')) return { rows: [{ workspaceId, role: 'owner' }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
      } as unknown as TenantTransaction;
      return operation(tx);
    },
    async withWorkspace(_workspace: string, operation: (tx: TenantTransaction) => Promise<unknown>) {
      const tx = {
        async query(sql: string, values?: readonly unknown[]) {
          if (sql.startsWith('UPDATE app_user')) {
            const row = users.get('seed@example.com');
            if (row) row.passwordHash = values?.[0] as string;
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes('FROM workspace_membership m')) {
            return { rows: [{ email: 'seed@example.com', displayName: 'Seed', passwordSet: true, workspaceId, workspaceName: 'Seed HQ', role: 'owner', plan: 'growth', subscriptionStatus: 'active' }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
      } as unknown as TenantTransaction;
      return operation(tx);
    },
  } as unknown as Database;
  return { database, users, inserts };
}

test('register creates the owner workspace and returns a session token', async () => {
  const { database, users, inserts } = fakeDatabase();
  const service = new EmailAuthService(config(), database);
  const session = await service.register({ email: 'New@Example.com', password: 'sup3r-secret', displayName: 'New' }, 'ip-1');
  assert.ok(users.has('new@example.com'));
  assert.deepEqual(inserts, ['membership']);
  assert.deepEqual(verifyAccessToken(session.accessToken, secret), {
    actorId: userId, workspaceId, role: 'owner',
    exp: Math.floor(new Date(session.expiresAt).getTime() / 1_000),
  });
});

test('register refuses an email that already holds an account', async () => {
  const { database } = fakeDatabase({ email: 'taken@example.com', passwordHash: null });
  const service = new EmailAuthService(config(), database);
  await assert.rejects(() => service.register({ email: 'taken@example.com', password: 'sup3r-secret' }, 'ip-2'), /email_already_registered/);
});

test('login verifies scrypt hashes and rejects wrong credentials', async () => {
  const { database } = fakeDatabase({ email: 'seed@example.com', passwordHash: hashPassword('right-password') });
  const service = new EmailAuthService(config(), database);
  const session = await service.login({ email: 'seed@example.com', password: 'right-password' }, 'ip-3');
  assert.equal(verifyAccessToken(session.accessToken, secret).role, 'owner');
  await assert.rejects(() => service.login({ email: 'seed@example.com', password: 'wrong-password' }, 'ip-4'), /invalid_credentials/);
  await assert.rejects(() => service.login({ email: 'ghost@example.com', password: 'right-password' }, 'ip-5'), /invalid_credentials/);
});

test('login is rate limited per client and email', async () => {
  const { database } = fakeDatabase({ email: 'seed@example.com', passwordHash: hashPassword('right-password') });
  const service = new EmailAuthService(config(), database);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await assert.rejects(() => service.login({ email: 'seed@example.com', password: 'wrong-password' }, 'ip-6'), /invalid_credentials/);
  }
  await assert.rejects(() => service.login({ email: 'seed@example.com', password: 'right-password' }, 'ip-6'), /rate_limited/);
});

test('me returns identity plus the subscription gate flag', async () => {
  const { database } = fakeDatabase({ email: 'seed@example.com', passwordHash: 'scrypt:stored' });
  const service = new EmailAuthService(config(), database);
  const me = await service.me(actor);
  assert.equal(me.user.email, 'seed@example.com');
  assert.equal(me.subscriptionStatus, 'active');
  assert.equal(me.plan, 'growth');
  assert.equal(me.user.passwordSet, true);
});

test('setPassword stores a fresh scrypt hash for the actor', async () => {
  const { database, users } = fakeDatabase({ email: 'seed@example.com', passwordHash: null });
  const service = new EmailAuthService(config(), database);
  const result = await service.setPassword(actor, { password: 'new-password-9' });
  assert.deepEqual(result, { passwordSet: true });
  assert.match(users.get('seed@example.com')?.passwordHash ?? '', /^scrypt:v1:/);
});
