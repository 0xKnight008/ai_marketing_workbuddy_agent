# Discord support replies → Resend

## What this repair changes

- Platform feedback now persists the thread ID returned by Discord. Previously the platform created a thread but discarded its ID, so the relay could not find that ticket.
- The Egg platform polls every 15 seconds independently of the workflow job runner. It no longer requires a separately running newsletter/public API process to deliver replies. The legacy Fastify development gateway does not run Egg schedules.
- The public API and platform share the same delivery implementation. Atomic database claims, two-minute leases and permanent `sent` records prevent concurrent pollers from sending the same message again.
- A persistent cursor processes replies oldest-first, up to five pages of 100 per ticket per pass. Polling rotates through open tickets in batches of 20. Inaccessible threads do not stop other tickets.
- Failed deliveries keep the cursor in place. Retries use the original persisted email payload and the same Resend idempotency key, including if the Discord message is edited. Only a successful provider acknowledgement containing an email ID can mark a reply sent.

No live email was sent as part of the automated tests. `sent` means Resend accepted the request, **not** that the recipient's mailbox delivered it.

## Rollout checklist

1. Back up the database. Stop any **old-version** reply poller before enabling this version: its previous upsert could reset already-sent records. The new enable/disable flag cannot disable an old binary that does not understand it.
2. Deploy the repository including `server/feedback-delivery.mjs`, not only the `platform` directory. Both runtimes import that dependency-free module. The public API Dockerfile includes it.
3. Using the platform's existing protected environment and database connection, run `npm run migrate` in `platform` to apply `0016_feedback_reply_delivery.sql`. Do not manually mark a migration applied. Do not start the new poller against the old schema.
4. Configure the following **in the actual platform process environment**, not only GitHub secrets or the public API container:

   ```dotenv
   DISCORD_BOT_TOKEN=<existing bot token>
   DISCORD_FEEDBACK_CHANNEL_ID=<private staff text-channel ID>
   RESEND_API_KEY=<existing Resend API key>
   RESEND_FROM_EMAIL="Piggybot <verified-sender@your-domain>"
   DISCORD_REPLY_DELIVERY_ENABLED=true
   # Optional override; otherwise RESEND_FROM_EMAIL is used:
   # FEEDBACK_FROM_EMAIL="Piggybot Support <verified-support@your-domain>"
   ```

5. Restart the actual Egg platform process with that environment. The reported host was running an interactive Node process in `/home/ubuntu/work/ai_marketing_workbuddy_agent/platform`; `piggybot-platform.service` was not installed. Do not assume a `systemctl restart` succeeded on that host. Use its established process manager, or set up service management as a separate deployment task.
6. If the public API is also deployed, upgrade it too. Either disable its poller with `DISCORD_REPLY_DELIVERY_ENABLED=false` or run both new versions against the same database. Use the same support sender configuration in both processes.

## Discord and Resend prerequisites

- Use a staff-only **text channel** with ticket threads. This integration does not create forum posts. All non-bot human text in a mapped ticket thread is treated as a customer-facing support reply; do not put private staff notes there.
- Enable the bot application's privileged **Message Content Intent** in the Discord Developer Portal. Without it, message content may be empty even when the API returns HTTP 200. Verified applications may need intent approval.
- Give the bot View Channel, Read Message History, Send Messages, Create Public Threads and Send Messages in Threads permissions as appropriate to that text channel and its threads. Keep customers and unrelated users out of the staff channel.
- Reply **inside the ticket thread**, not in the parent `#customer-feedback` channel. Bot, webhook and system messages are ignored. An attachment-only/empty human message pauses that ticket with `discord_reply_content_missing`; add text to that same message to recover it. Attachments are not emailed.
- `/close` sends a closure email and closes the ticket after provider acceptance. Subsequent thread replies are not sent while the ticket remains closed.
- Verify the sender/domain in Resend and the API key's sending permissions. If still using Resend's testing sender, check its recipient restrictions. Never paste tokens or secret keys into GitHub or support logs.
- This is outbound reply delivery, not an inbound email-to-Discord bridge. Customer replies to the email require a separately configured receiving mailbox/inbound integration.

References: [Discord messages and permissions](https://docs.discord.com/developers/resources/message), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Verification and diagnosis

Use a test customer mailbox you control. Submit one new feedback ticket, confirm its Discord thread, then post a short human reply inside that thread. Allow polling time (longer with many open tickets), and inspect these read-only queries through the existing admin database connection:

```sql
SELECT ticket_no, source, status, discord_thread_id,
       discord_last_message_id, discord_polled_at, discord_poll_error
FROM feedback_message
ORDER BY created_at DESC LIMIT 20;

SELECT ticket_no, provider_message_id, delivery_status, delivery_error,
       provider_delivery_id, delivery_first_attempt_at, sent_at
FROM feedback_reply
WHERE provider_message_id IS NOT NULL
ORDER BY created_at DESC LIMIT 20;
```

Interpretation:

| Observation | Next check |
| --- | --- |
| Missing thread ID | Discord notification errors; older platform tickets need manual correlation below. |
| `discord_polled_at` never updates | Migration, actual process environment, Egg scheduler and process logs. |
| `discord_thread_messages_failed_403` / `_404` | Bot permissions, deleted/inaccessible thread, correct Discord application. |
| Empty API results despite visible replies | Read Message History permission and correct thread ID. Discord can return an empty list without this permission. |
| `discord_reply_content_missing` | Message Content Intent or an attachment-only reply. |
| `resend_delivery_failed_401` / `_403` / `_422` | Resend key, verified sender, recipient restrictions and request validity. |
| `resend_delivery_failed_429` / `_503` | Provider throttling/outage; automatic retry preserves the payload and key. |
| `resend_delivery_reconciliation_required` | An uncertain attempt is older than 23 hours; perform the manual check below. |
| `sent` plus provider ID, mailbox empty | Find that ID in Resend delivery logs; check delivered/bounced/suppressed status and spam. |

Application errors record ticket ID and a sanitized code, not customer message text, provider response bodies or credentials. Restrict access to the support database: it contains customer email addresses and reply bodies.

## Historical tickets and uncertain sends

Old platform tickets may have a real Discord thread but no stored mapping. This migration cannot infer the correct thread from missing data. With polling disabled, locate the exact ticket number in Discord, verify the customer's original message, and have an operator associate that verified thread with the ticket. Review existing replies before enabling the poller: an empty cursor means replaying historical human messages, with already-recorded `sent` message IDs skipped. Do not guess thread IDs or bulk remap tickets.

Resend retains idempotency keys for 24 hours. This implementation automatically retries only within 23 hours of the first claim. For an older uncertain attempt, first locate the original send in Resend and check its delivery status. If it was accepted, reconcile the existing row with that provider ID and correct sent state; if it definitely was not sent, authorize a fresh send with an operator-reviewed procedure. Do not blindly delete delivery records or reset attempt timestamps: doing so can send duplicate customer emails. Previously pending/failed rows preserve their original age during migration.

## Tests

```sh
node --test server/*.test.mjs
cd platform
npm run typecheck
npm test
# Only against an EMPTY disposable PostgreSQL database, never production:
TEST_DATABASE_URL=<disposable-test-database> npm run test:postgres
```

PostgreSQL tests refuse an existing platform database and roll back DDL/fixtures. Test files run sequentially because they share the disposable database. Coverage includes migration upgrades, permanent sent deduplication, live/expired leases, stale-owner rejection, frozen retries, the idempotency cutoff, polling fairness and monotonic cursors.
