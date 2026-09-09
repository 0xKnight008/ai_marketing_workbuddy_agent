-- Global public newsletter directory; access only through the server/admin APIs.
CREATE TABLE newsletter_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  welcome_status text NOT NULL DEFAULT 'pending' CHECK (welcome_status IN ('pending', 'sending', 'failed', 'accepted', 'review_required')),
  welcome_payload jsonb,
  welcome_claim_token uuid,
  welcome_locked_until timestamptz,
  welcome_first_attempt_at timestamptz,
  welcome_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  welcome_attempts integer NOT NULL DEFAULT 0,
  welcome_error text,
  welcome_provider_id text,
  welcome_accepted_at timestamptz
);
REVOKE ALL ON newsletter_subscription FROM PUBLIC;
CREATE INDEX newsletter_welcome_queue ON newsletter_subscription (welcome_next_attempt_at, created_at)
  WHERE welcome_status IN ('pending', 'sending', 'failed');
