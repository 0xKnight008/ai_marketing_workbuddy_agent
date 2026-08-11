CREATE TABLE referral_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX referral_link_active_idx ON referral_link (workspace_id) WHERE revoked_at IS NULL;

CREATE TABLE referral_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code text NOT NULL REFERENCES referral_link(code),
  referrer_workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  referred_workspace_id uuid NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE CASCADE,
  source text,
  attributed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referral_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  attribution_id uuid NOT NULL REFERENCES referral_attribution(id) ON DELETE CASCADE,
  stripe_invoice_id text NOT NULL UNIQUE,
  amount_micros bigint NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'void', 'clawed_back')),
  available_at timestamptz,
  stripe_balance_txn text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE referral_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_link FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON referral_link USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
ALTER TABLE referral_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_attribution FORCE ROW LEVEL SECURITY;
CREATE POLICY referral_attribution_referrer_policy ON referral_attribution USING (referrer_workspace_id = current_setting('app.workspace_id', true)::uuid);
ALTER TABLE referral_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_credit_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON referral_credit_ledger USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE OR REPLACE FUNCTION attribute_referral(referral_code_input text, referred_workspace uuid, source_input text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE referrer uuid;
BEGIN
  SELECT workspace_id INTO referrer FROM referral_link WHERE code = referral_code_input AND revoked_at IS NULL;
  IF referrer IS NULL OR referrer = referred_workspace THEN RETURN false; END IF;
  INSERT INTO referral_attribution (referral_code, referrer_workspace_id, referred_workspace_id, source)
  VALUES (referral_code_input, referrer, referred_workspace, source_input)
  ON CONFLICT (referred_workspace_id) DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION accrue_referral_credit(invoice_id text, referred_workspace uuid, paid_micros bigint, invoice_currency text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE attribution referral_attribution%ROWTYPE; credit bigint; cap_left bigint;
BEGIN
  SELECT * INTO attribution FROM referral_attribution WHERE referred_workspace_id = referred_workspace AND attributed_at >= now() - interval '1 year';
  IF attribution.id IS NULL OR paid_micros <= 0 THEN RETURN false; END IF;
  credit := (paid_micros * 20) / 100;
  SELECT GREATEST(0, 2000000000 - COALESCE(SUM(amount_micros) FILTER (WHERE status IN ('pending','available')), 0)) INTO cap_left
    FROM referral_credit_ledger WHERE workspace_id = attribution.referrer_workspace_id AND created_at >= date_trunc('year', now());
  credit := LEAST(credit, cap_left);
  IF credit <= 0 THEN RETURN false; END IF;
  INSERT INTO referral_credit_ledger (workspace_id, attribution_id, stripe_invoice_id, amount_micros, currency, available_at)
  VALUES (attribution.referrer_workspace_id, attribution.id, invoice_id, credit, COALESCE(invoice_currency, 'usd'), now() + interval '30 days')
  ON CONFLICT (stripe_invoice_id) DO NOTHING;
  RETURN FOUND;
END;
$$;
