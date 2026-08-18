ALTER TABLE feedback_reply
  ADD COLUMN provider_message_id text,
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  ADD COLUMN delivery_error text;

CREATE UNIQUE INDEX feedback_reply_provider_message_idx
  ON feedback_reply (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
