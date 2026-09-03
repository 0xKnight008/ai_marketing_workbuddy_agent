-- Back-office list views stay responsive without weakening tenant RLS.
CREATE INDEX job_dead_lettered_updated_idx
  ON job (updated_at DESC)
  WHERE status = 'dead_lettered';

CREATE INDEX referral_credit_ledger_status_created_idx
  ON referral_credit_ledger (status, created_at DESC);
