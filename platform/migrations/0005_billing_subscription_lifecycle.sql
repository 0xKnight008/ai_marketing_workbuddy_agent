ALTER TABLE workspace_billing
  ADD COLUMN payment_grace_ends_at timestamptz;

CREATE INDEX workspace_billing_stripe_customer_idx
  ON workspace_billing (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
