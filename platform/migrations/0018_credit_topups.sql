-- Convert the previous monthly purchased allowance to a durable remaining balance.
WITH spent AS (
  SELECT b.workspace_id, GREATEST(0, COALESCE(SUM(CASE WHEN e.status = 'reversed' THEN -e.ai_credits ELSE e.ai_credits END), 0)
    - CASE b.plan WHEN 'creator' THEN 400 WHEN 'growth' THEN 2500 ELSE 8000 END) AS overage
  FROM workspace_billing b LEFT JOIN task_event e ON e.workspace_id = b.workspace_id
    AND e.created_at >= date_trunc('month', now())
  GROUP BY b.workspace_id
) UPDATE workspace_billing b SET purchased_ai_credits = GREATEST(0, b.purchased_ai_credits - spent.overage)
  FROM spent WHERE spent.workspace_id = b.workspace_id;

ALTER TABLE workspace_billing ADD COLUMN credit_refund_debt numeric(12,3) NOT NULL DEFAULT 0 CHECK (credit_refund_debt >= 0);
CREATE TABLE credit_topup (
  checkout_session_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id),
  payment_intent_id text UNIQUE NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 1000 AND 100000),
  credits integer NOT NULL CHECK (credits = amount_cents),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents BETWEEN 0 AND amount_cents),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE credit_topup ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_topup FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON credit_topup USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
