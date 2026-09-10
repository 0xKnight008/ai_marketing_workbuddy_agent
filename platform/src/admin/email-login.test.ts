import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AdminEmailLogin, adminPrincipal, ADMIN_COOKIE_OPTIONS } from './email-login';
import { AdminService } from './service';
import type { Database, TenantTransaction } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';

const email = 'admin@example.invalid';
const config = { PLATFORM_ADMIN_EMAILS: email, PUBLIC_SITE_URL: 'https://www.piggybot.me', RESEND_API_KEY: 'test-only', RESEND_FROM_EMAIL: 'admin@example.invalid' } as GatewayConfig;
function db(query: (sql: string, values: unknown[]) => unknown[]) {
  return { withAdmin: async (fn: (tx: TenantTransaction) => unknown) => fn({ query: async (sql: string, values: unknown[] = []) => ({ rows: query(sql, values), rowCount: 1 }) } as TenantTransaction) } as unknown as Database;
}
test('admin origin protection is exact and cookies are secure and inaccessible to JavaScript', () => {
  const login = new AdminEmailLogin(config, db(() => []));
  login.assertOrigin(config.PUBLIC_SITE_URL);
  for (const origin of [undefined, 'null', 'https://evil.invalid', 'https://www.piggybot.me.evil.invalid']) assert.throws(() => login.assertOrigin(origin), /admin_origin_forbidden/);
  assert.equal(ADMIN_COOKIE_OPTIONS.secure, true); assert.equal(ADMIN_COOKIE_OPTIONS.httpOnly, true); assert.equal(ADMIN_COOKIE_OPTIONS.sameSite, 'strict');
});
test('unknown or rate-limited emails cannot cause mail delivery', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not send'); });
  await new AdminEmailLogin(config, db(() => [{ attempts: 1 }])).requestLink({ email: 'other@example.invalid' }, 'ip');
  await new AdminEmailLogin(config, db(() => [{ attempts: 6 }])).requestLink({ email }, 'ip');
  await new AdminEmailLogin({ ...config, PLATFORM_ADMIN_EMAILS: '' }, db(() => [{ attempts: 1 }])).requestLink({ email }, 'ip');
  assert.equal(fetch.mock.callCount(), 0);
});
test('email uses a fragment token, stores only its hash, and invalidates failed delivery', async t => {
  let savedHash = ''; let mail = ''; let invalidated = false;
  const database = db((sql, values) => {
    if (sql.includes('INSERT INTO platform_admin_link')) savedHash = String(values[0]);
    if (sql.includes('UPDATE platform_admin_link')) invalidated = true;
    return [{ attempts: 1 }];
  });
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => { mail = JSON.parse(String(init?.body)).text; return Response.json({ id: 'mail-test' }); });
  await new AdminEmailLogin(config, database).requestLink({ email: email.toUpperCase() }, 'ip');
  const ticket = mail.match(/#admin_ticket=([A-Za-z0-9_-]{43})/)![1]!;
  assert.equal(savedHash, createHash('sha256').update(ticket).digest('hex')); assert.equal(invalidated, false);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'failed' }, { status: 500 }));
  await new AdminEmailLogin(config, database).requestLink({ email }, 'ip');
  assert.equal(invalidated, true);
});
test('only database-validated admin principals bypass the legacy secret', async () => {
  const database = db(sql => sql.includes('SELECT id,email') ? [{ id: 'session-id', email }] : []);
  const login = new AdminEmailLogin(config, database);
  const actor = await login.authenticate('a'.repeat(43));
  assert.equal(adminPrincipal(actor)?.email, email);
  const admin = new AdminService(config, database);
  assert.deepEqual(await admin.newsletter(actor, undefined, {}), []);
  await assert.rejects(admin.newsletter({ ...actor }, undefined, {}), /platform_admin_required/);
  await assert.rejects(new AdminEmailLogin({ ...config, PLATFORM_ADMIN_EMAILS: '' }, database).authenticate('a'.repeat(43)), /admin_session_required/);
  await assert.rejects(login.authenticate('short'), /admin_session_required/);
  await assert.rejects(new AdminEmailLogin(config, db(() => [])).exchange({ ticket: 'a'.repeat(43) }), /admin_link_invalid_or_expired/);
});
