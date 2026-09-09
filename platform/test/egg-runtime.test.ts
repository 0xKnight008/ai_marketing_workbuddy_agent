import mm from 'egg-mock';
import assert from 'node:assert/strict';

import { issueAccessToken } from '../src/identity/token';
import type { TenantTransaction } from '../src/foundation/database';

describe('Egg production gateway', () => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://piggybot:piggybot@127.0.0.1:5432/piggybot',
    AUTH_TOKEN_SECRET: 'test-auth-token-secret-must-be-at-least-32-bytes',
    AI_RUNTIME_EVENT_SIGNING_SECRET: 'test-runtime-event-secret-must-be-32-bytes',
    AI_RUNTIME_URL: 'http://127.0.0.1:4111',
    INTERNAL_SERVICE_TOKEN: 'test-internal-token',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
    PUBLIC_SITE_URL: 'https://www.piggybot.me',
    PLATFORM_ADMIN_EMAILS: 'admin@example.invalid',
  });
  const app = mm.app({ baseDir: process.cwd(), cache: false });
  const ownerToken = issueAccessToken({
    actorId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    role: 'owner',
    exp: Math.floor(Date.now() / 1000) + 300,
  }, process.env.AUTH_TOKEN_SECRET!);

  before(async () => { await app.ready(); });

  after(async () => { await app.close(); });
  afterEach(() => { mm.restore(); });

  it('serves health through Egg routing', () => app.httpRequest()
    .get('/internal/health')
    .expect(200)
    .expect({ ok: true, service: 'gateway' }));

  it('requires an independent admin session, not a workspace bearer token', () => app.httpRequest()
    .get('/api/admin/auth/session').set('authorization', `Bearer ${ownerToken}`).expect(401));
  it('rejects admin login CSRF before issuing email or querying storage', () => app.httpRequest()
    .post('/api/admin/auth/request').set('Origin', 'https://evil.invalid').send({ email: 'admin@example.invalid' })
    .expect(403).expect({ error: 'admin_origin_forbidden' }));
  it('rejects cookie-authenticated mutation without a trusted origin', () => app.httpRequest()
    .post('/api/admin/jobs/44444444-4444-4444-8444-444444444444/replay').set('Cookie', '__Host-piggybot_admin=untrusted')
    .send({}).expect(403));
  it('does not accept an admin cookie as a workspace login', () => app.httpRequest()
    .get('/api/auth/me').set('Cookie', '__Host-piggybot_admin=untrusted').expect(401));
  it('issues only a secure HttpOnly cookie, never returns the admin session in JSON', async () => {
    mm(app.config, 'proxy', true);
    mm(app.platform.service.adminEmailLogin, 'exchange', async () => 'a'.repeat(43));
    await app.httpRequest().post('/api/admin/auth/exchange').set('Origin', 'https://www.piggybot.me')
      .set('X-Forwarded-Proto', 'https').send({ ticket: 'b'.repeat(43) }).expect(200).expect({ ok: true })
      .expect(response => {
        const cookie = String(response.headers['set-cookie']);
        assert.match(cookie, /__Host-piggybot_admin=/); assert.match(cookie, /httponly/i);
        assert.match(cookie, /secure/i); assert.match(cookie, /samesite=strict/i); assert.doesNotMatch(cookie, /domain=/i);
      });
  });
  it('authenticates an allowlisted server-side admin session without workspace credentials', async () => {
    mm(app.platform.database, 'withAdmin', async (operation: (tx: TenantTransaction) => Promise<void>) => operation({
      query: async () => ({ rows: [{ id: 'session-id', email: 'admin@example.invalid' }], rowCount: 1 }),
    } as unknown as TenantTransaction));
    await app.httpRequest().get('/api/admin/auth/session').set('Cookie', `__Host-piggybot_admin=${'a'.repeat(43)}`)
      .expect(200).expect({ email: 'admin@example.invalid' });
  });

  it('reports ready only after checking the auth database', async () => {
    mm(app.platform.database, 'withAdmin', async (operation: (tx: TenantTransaction) => Promise<void>) => operation({
      query: async () => ({ rows: [], rowCount: 0 }),
    }));
    await app.httpRequest().get('/internal/ready').expect('Cache-Control', 'no-store')
      .expect(200).expect({ ok: true, service: 'gateway', authSchema: 'ready' });
  });

  it('returns 503 without private SQL details when auth schema is missing', async () => {
    mm(app.platform.database, 'withAdmin', async () => { throw new Error('column password_hash does not exist'); });
    await app.httpRequest().get('/internal/ready').expect('Cache-Control', 'no-store')
      .expect(503).expect({ error: 'auth_database_not_ready' });
  });

  it('exposes email login and rejects invalid input before accessing the database', () => app.httpRequest()
    .post('/api/auth/login').send({})
    .expect('Cache-Control', 'no-store').expect(400).expect({ error: 'invalid_request' }));

  it('exposes registration and rejects invalid input before accessing the database', () => app.httpRequest()
    .post('/api/auth/register').send({})
    .expect('Cache-Control', 'no-store').expect(400).expect({ error: 'invalid_request' }));

  it('requires a valid session for identity lookup', () => app.httpRequest()
    .get('/api/auth/me').expect(401).expect({ error: 'unauthorized' }));

  it('applies the shared error middleware before a controller uses the database', () => app.httpRequest()
    .post('/api/workflow-runs')
    .send({})
    .expect(401)
    .expect({ error: 'unauthorized' }));

  it('rejects unsigned runtime events while retaining raw-body verification', () => app.httpRequest()
    .post('/internal/ai-runtime-events')
    .send({ eventId: 'not-trusted' })
    .expect(401)
    .expect({ error: 'unauthorized' }));

  it('rejects unauthenticated checkout confirmations before Stripe calls', () => app.httpRequest()
    .post('/api/billing/checkout-session/confirm')
    .send({ sessionId: 'cs_test_trial' })
    .expect(401));

  it('exposes checkout through Egg and requires an authenticated owner', () => app.httpRequest()
    .post('/api/billing/checkout-session')
    .send({ plan: 'growth' })
    .expect(401)
    .expect({ error: 'unauthorized' }));

  it('retains the exact Stripe body and rejects an unsigned webhook', () => app.httpRequest()
    .post('/webhooks/stripe')
    .send({ id: 'evt_untrusted', type: 'checkout.session.completed' })
    .expect(401)
    .expect({ error: 'stripe_signature_missing' }));

  it('exposes one-time activation exchange and rejects an invalid ticket', () => app.httpRequest()
    .post('/api/activation/exchange')
    .send({ ticket: 'not-a-valid-activation-ticket' })
    .expect('Cache-Control', 'no-store')
    .expect(401)
    .expect({ error: 'activation_ticket_invalid' }));

  it('exposes the admin workspace inventory with no-store and requires both factors', () => app.httpRequest()
    .get('/api/admin/workspaces')
    .expect('Cache-Control', 'no-store')
    .expect(401)
    .expect({ error: 'unauthorized' }));

  it('protects admin mutations before touching tenant data', () => app.httpRequest()
    .post('/api/admin/jobs/44444444-4444-4444-8444-444444444444/replay')
    .send({ workspaceId: '33333333-3333-4333-8333-333333333333' })
    .expect('Cache-Control', 'no-store')
    .expect(401)
    .expect({ error: 'unauthorized' }));

  it('rejects a valid owner session when the independent admin factor is missing', () => app.httpRequest()
    .get('/api/admin/workspaces')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect('Cache-Control', 'no-store')
    .expect(403)
    .expect({ error: 'platform_admin_required' }));

  it('allows the admin header and PATCH method in browser preflights', () => app.httpRequest()
    .options('/api/admin/feedback/FB-A1B2C3D4')
    .set('Origin', 'http://localhost:5173')
    .expect('Access-Control-Allow-Headers', /X-Billing-Admin-Token/)
    .expect('Access-Control-Allow-Methods', /PATCH/)
    .expect(204));

  for (const route of ['/api/billing/portal', '/api/billing/credit-topup', '/api/billing/credit-topup/confirm']) {
    it(`requires authentication for ${route}`, () => app.httpRequest().post(route).send({}).expect(401));
  }
  it('requires authentication for the billing dashboard', () => app.httpRequest().get('/api/billing/dashboard').expect(401));
  it('protects newsletter subscriber PII and disables caching', () => app.httpRequest().get('/api/admin/newsletter').expect('Cache-Control', 'no-store').expect(401));
});
