import { randomUUID } from 'node:crypto';

export function createNewsletterStore(database) {
  return {
    async subscribe(email) {
      await database.query(`INSERT INTO newsletter_subscription (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`, [email]);
    },
    async claimWelcome(payload) {
      // Never retry outside the provider's 24-hour idempotency window.
      await database.query(`UPDATE newsletter_subscription SET welcome_status = 'review_required', welcome_error = 'resend_reconciliation_required'
        WHERE welcome_status IN ('sending', 'failed') AND welcome_first_attempt_at <= now() - interval '23 hours'
          AND (welcome_locked_until IS NULL OR welcome_locked_until < now())`);
      const claimToken = randomUUID();
      const result = await database.query(`UPDATE newsletter_subscription SET welcome_status = 'sending', welcome_claim_token = $1,
          welcome_locked_until = now() + interval '2 minutes', welcome_first_attempt_at = COALESCE(welcome_first_attempt_at, now()),
          welcome_attempts = welcome_attempts + 1,
          welcome_payload = COALESCE(welcome_payload, $2::jsonb || jsonb_build_object('to', jsonb_build_array(email)))
        WHERE id = (SELECT id FROM newsletter_subscription WHERE welcome_status IN ('pending', 'failed', 'sending')
          AND welcome_next_attempt_at <= now() AND (welcome_locked_until IS NULL OR welcome_locked_until < now())
          AND (welcome_first_attempt_at IS NULL OR welcome_first_attempt_at > now() - interval '23 hours')
          ORDER BY welcome_next_attempt_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, welcome_payload AS payload, welcome_claim_token AS "claimToken"`, [claimToken, payload]);
      return result.rows[0];
    },
    async finishWelcome(job, providerId) {
      const result = await database.query(`UPDATE newsletter_subscription SET welcome_status = 'accepted', welcome_provider_id = $3,
        welcome_accepted_at = now(), welcome_error = NULL, welcome_locked_until = NULL
        WHERE id = $1 AND welcome_claim_token = $2 AND welcome_status = 'sending'`, [job.id, job.claimToken, providerId]);
      if (result.rowCount !== 1) throw new Error('newsletter_claim_lost');
    },
    async failWelcome(job, code) {
      await database.query(`UPDATE newsletter_subscription SET welcome_status = 'failed', welcome_error = $3,
        welcome_locked_until = NULL, welcome_next_attempt_at = now() + interval '5 minutes'
        WHERE id = $1 AND welcome_claim_token = $2 AND welcome_status = 'sending'`, [job.id, job.claimToken, code]);
    },
  };
}

export function welcomeTemplate(env) {
  const id = env.NEWSLETTER_TEMPLATE_ID?.trim() || 'welcome-email';
  const cta = new URL(env.NEWSLETTER_CTA_URL || 'https://www.piggybot.me/app');
  if (cta.protocol !== 'https:' || cta.username || cta.password) throw new Error('newsletter_cta_url_invalid');
  // Sender, subject and content are maintained on the published Resend template.
  return { template: { id, variables: { cta_url: cta.href, first_name: env.NEWSLETTER_DEFAULT_FIRST_NAME?.trim() || 'there' } } };
}

export async function deliverNewsletterWelcomes({ env, newsletterStore, fetchImpl = fetch, reportError = (detail) => console.error('Newsletter welcome failed', detail) }) {
  if (!newsletterStore || !env.RESEND_API_KEY || env.NEWSLETTER_WELCOME_ENABLED === 'false') return;
  const payload = welcomeTemplate(env);
  for (let i = 0; i < 10; i++) {
    const job = await newsletterStore.claimWelcome(payload);
    if (!job) return;
    try {
      const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `newsletter-welcome/${job.id}` },
        body: JSON.stringify(job.payload), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`resend_welcome_http_${response.status}`);
      const result = await response.json();
      if (typeof result.id !== 'string' || !result.id) throw new Error('resend_welcome_missing_id');
      await newsletterStore.finishWelcome(job, result.id);
    } catch (error) {
      const code = error instanceof Error && /^(resend_welcome_|newsletter_)[a-z0-9_]+$/.test(error.message) ? error.message : 'resend_welcome_transport_failed';
      await newsletterStore.failWelcome(job, code);
      reportError({ subscriptionId: job.id, code });
    }
  }
}
