import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { createNewsletterStore, welcomeTemplate } from '../../server/newsletter.mjs';

test('newsletter deduplication, persistent leases and retry window on PostgreSQL', async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Disposable test database required');
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL }); await client.connect();
  try {
    await client.query('BEGIN');
    assert.equal((await client.query("SELECT to_regclass('public.newsletter_subscription') AS table_name")).rows[0].table_name, null, 'Refusing an existing newsletter database');
    await client.query(await readFile(new URL('../migrations/0019_newsletter_subscriptions.sql', import.meta.url), 'utf8'));
    const store = createNewsletterStore(client); const payload = welcomeTemplate({});
    await store.subscribe('test@example.invalid'); await store.subscribe('test@example.invalid');
    assert.equal((await client.query('SELECT count(*)::int AS n FROM newsletter_subscription')).rows[0].n, 1);
    const first = await store.claimWelcome(payload); assert.ok(first);
    assert.equal(await store.claimWelcome(payload), undefined, 'another poller cannot reclaim a live lease');
    await store.failWelcome(first, 'resend_welcome_http_503');
    assert.equal(await store.claimWelcome(payload), undefined, 'retries wait for backoff');
    await client.query("UPDATE newsletter_subscription SET welcome_next_attempt_at = now() - interval '1 second'");
    const retry = await store.claimWelcome(welcomeTemplate({ NEWSLETTER_TEMPLATE_ID: 'changed' }));
    assert.notEqual(retry.claimToken, first.claimToken); assert.deepEqual(retry.payload, first.payload);
    await assert.rejects(store.finishWelcome(first, 'stale-provider'), /newsletter_claim_lost/);
    await store.finishWelcome(retry, 'provider-id');
    assert.equal(await store.claimWelcome(payload), undefined);
    await store.subscribe('test@example.invalid'); assert.equal(await store.claimWelcome(payload), undefined);
    await store.subscribe('expired@example.invalid'); const expired = await store.claimWelcome(payload);
    await client.query("UPDATE newsletter_subscription SET welcome_first_attempt_at = now() - interval '24 hours', welcome_locked_until = now() - interval '1 second' WHERE id = $1", [expired.id]);
    assert.equal(await store.claimWelcome(payload), undefined);
    assert.equal((await client.query('SELECT welcome_status FROM newsletter_subscription WHERE id = $1', [expired.id])).rows[0].welcome_status, 'review_required');
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
