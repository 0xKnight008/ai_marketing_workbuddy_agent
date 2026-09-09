import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverNewsletterWelcomes, welcomeTemplate } from './newsletter.mjs';

test('uses published template variables and leaves sender/content defaults in Resend', () => {
  assert.deepEqual(welcomeTemplate({}), { template: { id: 'welcome-email', variables: { cta_url: 'https://www.piggybot.me/app', first_name: 'there' } } });
  assert.equal(welcomeTemplate({ NEWSLETTER_DEFAULT_FIRST_NAME: 'friend' }).template.variables.first_name, 'friend');
  assert.throws(() => welcomeTemplate({ NEWSLETTER_CTA_URL: 'javascript:alert(1)' }));
});
test('missing key or explicit disable never claims queued work', async () => {
  const newsletterStore = { claimWelcome() { throw new Error('must not claim'); } };
  await deliverNewsletterWelcomes({ env: {}, newsletterStore });
  await deliverNewsletterWelcomes({ env: { RESEND_API_KEY: 'test', NEWSLETTER_WELCOME_ENABLED: 'false' }, newsletterStore });
});
test('sends frozen template payload with a stable idempotency key', async () => {
  const job = { id: 'test-id', claimToken: 'claim', payload: { to: ['test@example.invalid'], ...welcomeTemplate({}) } };
  let claims = 0; let accepted;
  await deliverNewsletterWelcomes({ env: { RESEND_API_KEY: 'test' }, newsletterStore: {
    async claimWelcome() { return claims++ === 0 ? job : undefined; },
    async finishWelcome(value, id) { assert.equal(value, job); accepted = id; },
    async failWelcome() { assert.fail('unexpected failure'); },
  }, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers['Idempotency-Key'], 'newsletter-welcome/test-id');
    assert.deepEqual(JSON.parse(options.body), job.payload);
    return Response.json({ id: 'resend-test' });
  } });
  assert.equal(accepted, 'resend-test');
});
for (const failure of ['http', 'transport', 'missing_id']) test(`persists sanitized ${failure} failures without leaking recipient or provider body`, async () => {
  let claimed = false; let code; const reports = [];
  await deliverNewsletterWelcomes({ env: { RESEND_API_KEY: 'test' }, newsletterStore: {
    async claimWelcome() { if (claimed) return; claimed = true; return { id: 'test-id', payload: {} }; },
    async failWelcome(_job, value) { code = value; },
  }, reportError: value => reports.push(value), fetchImpl: async () => {
    if (failure === 'transport') throw new Error('private provider information');
    return Response.json(failure === 'http' ? { message: 'private provider information' } : {}, { status: failure === 'http' ? 422 : 200 });
  } });
  assert.match(code, /^resend_welcome_/); assert.equal(JSON.stringify(reports).includes('private'), false);
});
