# Scheduled notification content integrity

Scheduled notifications no longer slice the frozen message at send time. Discord
messages over the existing 1,900-character delivery budget, and email messages over
12,000 characters, are recorded as failed with their original text intact.

The Notification Center exposes `notification_discord_content_too_long_use_email`
or `notification_email_content_too_long`. Failed events are not queued or announced
as ready for approval. A worker-side check also protects already-queued oversized
events from earlier deployments. In-budget messages are sent unchanged.

For an oversized Discord digest, select email for future scheduled deliveries or
use the report's explicit delivery flow. Changing a rule does not resend an old
failed event, and this change does not restore text from already-sent messages.
No database migration or new credentials are required.

Verification: platform typecheck and full platform test suite, including exact
boundary checks and mocked scheduling/worker regressions. No live Discord or
email messages were sent during verification.
