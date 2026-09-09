# Newsletter signup and welcome email

The previous Google Form returned HTTP 410 from the production server. Newsletter signup now uses PostgreSQL as its source of truth and no longer contacts Google Forms. Existing historical Google Sheet rows are not imported by this change.

## Deploy

1. Back up the database and run the platform migrations, including `0019_newsletter_subscriptions.sql`, before restarting the public API and platform. Both must point to the same PostgreSQL database. Use the existing migration/deployment workflow; do not run the SQL repeatedly by hand.
2. Deploy the `server` files (including `newsletter.mjs`) and restart the process running `subscribe-server.mjs`. Container deployments must rebuild `Dockerfile.subscribe`. The public API owns the welcome-email poller; the Egg support poller does not send newsletter emails.
3. Ensure same-origin `/api/subscribe` routes to the public API. `VITE_GATEWAY_URL` is not used for newsletter signup. Static-only deployments need that reverse proxy.
4. Set the public API's `RESEND_API_KEY`. Publish the Resend template with alias **welcome-email**, including its default sender and subject. The sender domain must be verified. The app sends only recipient plus the published template reference and variables, not HTML or text.
5. Optional public API settings (defaults shown):

   ```dotenv
   NEWSLETTER_TEMPLATE_ID=welcome-email
   NEWSLETTER_CTA_URL=https://www.piggybot.me/app
   NEWSLETTER_DEFAULT_FIRST_NAME=there
   NEWSLETTER_WELCOME_ENABLED=true
   ```

   Template variables are exactly `cta_url` and `first_name`. Since signup only collects email, the default greeting is used; the app does not infer a person's name from their email. Template content changes are managed and published in Resend. Set `NEWSLETTER_WELCOME_ENABLED=false` to pause sends while continuing to collect signups.
6. For anti-abuse protection, configure the existing frontend `VITE_TURNSTILE_SITE_KEY` and public API `TURNSTILE_SECRET` together. The footer includes a challenge when configured, a honeypot and server-side rate limiting.

## Admin lookup

Open the existing internal admin dashboard, supply the privileged session and independent admin secret, then select **Newsletter subscribers**. Search by email; pages contain up to 100 records. The list shows signup time, welcome status, attempt count, sanitized error code and Resend email ID. It is not exposed by the public signup endpoint or ordinary workspace billing APIs.

## Delivery semantics

- A successful signup response means the email address is durably stored. It does not claim the welcome email reached the inbox.
- Addresses are trimmed/lowercased and unique. Duplicate signup returns the same generic success without another welcome email or revealing whether the address existed.
- The poller claims a persisted job before sending. Multiple public API processes share leased claims. Template variables and recipient payload are frozen at the first attempt, and retries retain `newsletter-welcome/<subscription-id>` as the idempotency key.
- `pending`: not attempted yet (check worker, API key and enabled flag if it persists). `sending`: currently leased. `failed`: retried after five minutes. `accepted`: Resend returned an email ID, **not proof of inbox delivery**. Use that ID in Resend to inspect delivery, suppression or bounce.
- After 23 hours from the first attempt, an uncertain/failed delivery becomes `review_required`; automatic retries stop before Resend's 24-hour idempotency window expires. Inspect provider logs before any manual reconciliation. There is intentionally no blind “resend all” button.
- Fix an unpublished/missing template or template configuration error in Resend; queued jobs retry within the safe window. Changes to template ID/variables do not rewrite already-attempted jobs.
- This feature collects signup consent and sends one welcome email; it does not implement bulk newsletter campaigns. Before sending campaigns, add unsubscribe/suppression handling or integrate a consent-aware mailing system.

## Verification

Public API tests use mock database/provider calls, and PostgreSQL CI tests the actual migration, deduplication, leases, frozen payload, backoff and retry cutoff. Admin tests require both authorization factors. Do not use real customer addresses for tests without permission. After deployment, complete one authorized test signup, find it in Admin, inspect the Resend ID and verify inbox receipt; repeat signup to confirm no second welcome message.

References: [Resend templates](https://resend.com/docs/dashboard/templates/introduction), [send-email API](https://resend.com/docs/api-reference/emails/send-email), [idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys).
