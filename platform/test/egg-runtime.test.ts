import mm from 'egg-mock';

import { issueAccessToken } from '../src/identity/token';

describe('Egg production gateway', () => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://piggybot:piggybot@127.0.0.1:5432/piggybot',
    AUTH_TOKEN_SECRET: 'test-auth-token-secret-must-be-at-least-32-bytes',
    AI_RUNTIME_EVENT_SIGNING_SECRET: 'test-runtime-event-secret-must-be-32-bytes',
    AI_RUNTIME_URL: 'http://127.0.0.1:4111',
    INTERNAL_SERVICE_TOKEN: 'test-internal-token',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
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

  it('serves health through Egg routing', () => app.httpRequest()
    .get('/internal/health')
    .expect(200)
    .expect({ ok: true, service: 'gateway' }));

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
});
