import mm from 'egg-mock';

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
});
