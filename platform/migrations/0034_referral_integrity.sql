-- Durable invoice/refund facts survive webhook reordering. Money is USD micros,
-- rounded down to whole cents BEFORE it enters the reward ledger.
CREATE TABLE referral_invoice_fact (
  invoice_id text PRIMARY KEY,
  referred_workspace_id uuid REFERENCES workspace(id),
  paid_micros bigint,
  currency text,
  refunded boolean NOT NULL DEFAULT false,
  processed boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE referral_invoice_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_invoice_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON referral_invoice_fact
  USING (referred_workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE referral_credit_ledger DROP CONSTRAINT referral_credit_ledger_status_check;
ALTER TABLE referral_credit_ledger ADD CONSTRAINT referral_credit_ledger_status_check
  CHECK (status IN ('pending','issuing','available','void','reversal_pending','clawed_back'));
ALTER TABLE referral_credit_ledger
  ADD COLUMN reversal_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN issuing_started_at timestamptz,
  ADD COLUMN reversal_started_at timestamptz,
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_reversal_txn text;

UPDATE referral_credit_ledger l SET status = 'issuing', issuing_started_at = '1970-01-01'::timestamptz
WHERE l.status = 'pending' AND EXISTS (
  SELECT 1 FROM job j WHERE j.workspace_id = l.workspace_id AND j.kind = 'issue_referral_credit'
    AND j.payload->>'invoiceId' = l.stripe_invoice_id AND j.attempt > 0
);

-- Do not guess whether historical clawbacks reached Stripe. Pending legacy
-- reversals need explicit reconciliation rather than an unsafe fresh POST.
UPDATE referral_credit_ledger l SET status = 'reversal_pending', reversal_requested = true,
  reversal_started_at = '1970-01-01'::timestamptz
WHERE l.status = 'clawed_back' AND EXISTS (
  SELECT 1 FROM job j WHERE j.workspace_id = l.workspace_id AND j.kind = 'clawback_referral_credit'
    AND j.payload->>'invoiceId' = l.stripe_invoice_id AND j.status <> 'succeeded'
);

CREATE OR REPLACE FUNCTION accrue_referral_credit(invoice_id text, referred_workspace uuid, paid_micros bigint, invoice_currency text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE attribution referral_attribution%ROWTYPE; fact referral_invoice_fact%ROWTYPE;
  credit bigint; cap_left bigint;
BEGIN
  IF paid_micros IS NULL OR referred_workspace IS NULL OR invoice_id IS NULL OR invoice_id = ''
    OR paid_micros <= 0 OR paid_micros > 9007199254740000 OR paid_micros % 10000 <> 0
    OR invoice_currency IS DISTINCT FROM 'usd' THEN RETURN false; END IF;
  -- Same ordering in attribute_referral: serialize binding and invoice intake.
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-referee:' || referred_workspace::text, 0));
  INSERT INTO referral_invoice_fact(invoice_id, referred_workspace_id, paid_micros, currency)
    VALUES(invoice_id, referred_workspace, paid_micros, invoice_currency)
    ON CONFLICT ON CONSTRAINT referral_invoice_fact_pkey DO UPDATE SET
      referred_workspace_id = COALESCE(referral_invoice_fact.referred_workspace_id, EXCLUDED.referred_workspace_id),
      paid_micros = COALESCE(referral_invoice_fact.paid_micros, EXCLUDED.paid_micros),
      currency = COALESCE(referral_invoice_fact.currency, EXCLUDED.currency);
  SELECT * INTO fact FROM referral_invoice_fact f WHERE f.invoice_id = accrue_referral_credit.invoice_id FOR UPDATE;
  IF fact.referred_workspace_id <> referred_workspace OR fact.paid_micros <> paid_micros
    OR fact.currency <> invoice_currency THEN RAISE EXCEPTION 'referral_invoice_conflict'; END IF;
  IF fact.processed OR fact.refunded THEN RETURN false; END IF;
  SELECT * INTO attribution FROM referral_attribution a WHERE a.referred_workspace_id = referred_workspace
    AND a.attributed_at >= fact.received_at - interval '1 year';
  IF attribution.id IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-cap:' || attribution.referrer_workspace_id::text, 0));
  UPDATE referral_invoice_fact f SET processed = true WHERE f.invoice_id = accrue_referral_credit.invoice_id;
  -- Divide before multiplying: bigint cannot overflow. $0.01 is 10,000 micros.
  credit := (paid_micros / 50000) * 10000;
  SELECT GREATEST(0, 2000000000 - COALESCE(SUM(l.amount_micros), 0)) INTO cap_left
    FROM referral_credit_ledger l WHERE l.workspace_id = attribution.referrer_workspace_id
      AND l.created_at >= now() - interval '12 months'
      AND l.status IN ('pending','issuing','available','reversal_pending');
  credit := LEAST(credit, (cap_left / 10000) * 10000);
  IF credit <= 0 THEN RETURN false; END IF;
  INSERT INTO referral_credit_ledger(workspace_id, attribution_id, stripe_invoice_id, amount_micros, currency, available_at)
    VALUES(attribution.referrer_workspace_id, attribution.id, invoice_id, credit, 'usd', now() + interval '30 days')
    ON CONFLICT (stripe_invoice_id) DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO job(workspace_id, kind, payload, available_at, max_attempts)
    VALUES(attribution.referrer_workspace_id, 'issue_referral_credit', jsonb_build_object('invoiceId', invoice_id), now() + interval '30 days', 5);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION attribute_referral(referral_code_input text, referred_workspace uuid, source_input text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE referrer uuid; inserted boolean; fact referral_invoice_fact%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-referee:' || referred_workspace::text, 0));
  SELECT workspace_id INTO referrer FROM referral_link WHERE code = referral_code_input AND revoked_at IS NULL;
  IF referrer IS NULL OR referrer = referred_workspace THEN RETURN false; END IF;
  -- Reject workspaces owned by the same authenticated user, not merely same UUID.
  IF EXISTS (SELECT 1 FROM workspace_membership a JOIN workspace_membership b ON a.user_id = b.user_id
    WHERE a.workspace_id = referrer AND b.workspace_id = referred_workspace AND a.role = 'owner' AND b.role = 'owner') THEN RETURN false; END IF;
  INSERT INTO referral_attribution(referral_code, referrer_workspace_id, referred_workspace_id, source)
    VALUES(referral_code_input, referrer, referred_workspace, source_input)
    ON CONFLICT (referred_workspace_id) DO NOTHING;
  inserted := FOUND;
  FOR fact IN SELECT * FROM referral_invoice_fact f WHERE f.referred_workspace_id = referred_workspace
    AND NOT f.processed AND NOT f.refunded ORDER BY f.received_at, f.invoice_id
  LOOP
    PERFORM accrue_referral_credit(fact.invoice_id, referred_workspace, fact.paid_micros, fact.currency);
  END LOOP;
  RETURN inserted;
END;
$$;

CREATE OR REPLACE FUNCTION queue_referral_clawback(invoice_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ledger referral_credit_ledger%ROWTYPE;
BEGIN
  -- Refund-first is retained even when no paid event / attribution exists yet.
  INSERT INTO referral_invoice_fact(invoice_id, refunded) VALUES(invoice_id, true)
    ON CONFLICT ON CONSTRAINT referral_invoice_fact_pkey DO UPDATE SET refunded = true;
  SELECT * INTO ledger FROM referral_credit_ledger WHERE stripe_invoice_id = invoice_id FOR UPDATE;
  IF ledger.id IS NULL THEN RETURN false; END IF;
  IF ledger.status = 'pending' THEN
    UPDATE referral_credit_ledger SET status = 'void', reversal_requested = true WHERE id = ledger.id;
    RETURN true;
  END IF;
  IF ledger.status = 'issuing' THEN
    UPDATE referral_credit_ledger SET reversal_requested = true WHERE id = ledger.id;
    RETURN true;
  END IF;
  IF ledger.status <> 'available' THEN RETURN false; END IF;
  UPDATE referral_credit_ledger SET status = 'reversal_pending', reversal_requested = true WHERE id = ledger.id;
  INSERT INTO job(workspace_id, kind, payload, max_attempts)
    VALUES(ledger.workspace_id, 'clawback_referral_credit', jsonb_build_object('invoiceId', invoice_id), 5);
  RETURN true;
END;
$$;
