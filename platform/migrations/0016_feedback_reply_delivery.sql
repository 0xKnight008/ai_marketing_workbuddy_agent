-- Shared, durable reply delivery for the Egg platform and public API.
ALTER TABLE feedback_message
  ADD COLUMN discord_last_message_id text,
  ADD COLUMN discord_polled_at timestamptz,
  ADD COLUMN discord_poll_error text;

ALTER TABLE feedback_reply
  ADD COLUMN delivery_claim_token uuid,
  ADD COLUMN delivery_locked_until timestamptz,
  ADD COLUMN delivery_first_attempt_at timestamptz,
  ADD COLUMN delivery_payload jsonb,
  ADD COLUMN provider_delivery_id text,
  ADD COLUMN sent_at timestamptz;

-- Old pending/failed requests may already have reached Resend. Do not reset
-- their age and blindly retry beyond the provider's 24-hour idempotency window.
UPDATE feedback_reply
   SET delivery_first_attempt_at = created_at
 WHERE provider_message_id IS NOT NULL AND delivery_status IN ('pending', 'failed');

CREATE INDEX feedback_message_poll_idx ON feedback_message (discord_polled_at NULLS FIRST, created_at)
  WHERE status IN ('new', 'replied') AND discord_thread_id IS NOT NULL;
