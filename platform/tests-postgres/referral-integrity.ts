import assert from 'node:assert/strict';
import type { Client } from 'pg';
import { Database } from '../src/foundation/database';
import { activeReferralLink, referralSummary } from '../src/referral/service';
import { settleReferral } from '../src/referral/settlement';
import type { ClaimedJob } from '../src/run-service/worker-runner';

/** Called only by auth-schema.test against its empty, disposable migrated DB. */
export async function referralIntegrityRegression(client: Client, database: Database): Promise<void> {
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push((await client.query(`INSERT INTO workspace(name,slug)
    VALUES ('Referral regression', $1) RETURNING id`, [`referral-regression-${i}`])).rows[0].id);
  const [referrer, referee, other, foreign] = ids as [string, string, string, string];
  const links = await Promise.all(Array.from({ length: 5 }, () => database.withWorkspace(referrer, activeReferralLink)));
  assert.equal(new Set(links.map(l => l.code)).size, 1, 'concurrent link creation converges without aborted transactions');
  const code = links[0]!.code;
  const accrue = (invoice: string, paid: string | number, owner = referee, currency = 'usd') => database.withWorkspace(owner, tx =>
    tx.query('SELECT accrue_referral_credit($1,$2::uuid,$3::bigint,$4)', [invoice, owner, paid, currency]));
  const bind = (owner: string, ref = code) => database.withWorkspace(owner, tx =>
    tx.query('SELECT attribute_referral($1,$2::uuid)', [ref, owner]));
  const refund = (invoice: string) => database.withWorkspace(referrer, tx => tx.query('SELECT queue_referral_clawback($1)', [invoice]));
  await accrue('in_ref_order', 1000000); // before attribution
  assert.equal((await client.query("SELECT count(*) FROM referral_credit_ledger WHERE stripe_invoice_id='in_ref_order'")).rows[0].count, '0');
  await bind(referee);
  assert.equal((await client.query("SELECT amount_micros FROM referral_credit_ledger WHERE stripe_invoice_id='in_ref_order'")).rows[0].amount_micros, '200000');
  await Promise.all(Array.from({ length: 5 }, () => accrue('in_ref_order', 1000000)));
  assert.equal((await client.query("SELECT count(*) FROM referral_credit_ledger WHERE stripe_invoice_id='in_ref_order'")).rows[0].count, '1');
  await refund('in_ref_refund_first');
  await accrue('in_ref_refund_first', 1000000);
  assert.equal((await client.query("SELECT count(*) FROM referral_credit_ledger WHERE stripe_invoice_id='in_ref_refund_first'")).rows[0].count, '0');
  await accrue('in_ref_round', 90000);
  assert.equal((await client.query("SELECT amount_micros FROM referral_credit_ledger WHERE stripe_invoice_id='in_ref_round'")).rows[0].amount_micros, '10000');
  await accrue('in_ref_tiny', 10000);
  await accrue('in_ref_overflow', '9223372036854775807');
  await accrue('in_ref_eur', 1000000, referee, 'eur');
  assert.equal((await client.query("SELECT count(*) FROM referral_credit_ledger WHERE stripe_invoice_id IN ('in_ref_tiny','in_ref_overflow','in_ref_eur')")).rows[0].count, '0');
  await bind(other);
  const alternate = await database.withWorkspace(foreign, activeReferralLink);
  await bind(referee, alternate.code);
  assert.equal((await client.query('SELECT referrer_workspace_id FROM referral_attribution WHERE referred_workspace_id=$1', [referee])).rows[0].referrer_workspace_id, referrer);
  assert.equal((await bind(referrer)).rows[0]!.attribute_referral, false);
  // A shared authenticated owner cannot self-refer via another workspace.
  const user = (await client.query("INSERT INTO app_user(email,display_name) VALUES('referral-owner@example.invalid','Owner') RETURNING id")).rows[0].id;
  await client.query("INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$3,'owner'),($2,$3,'owner')", [referrer, foreign, user]);
  assert.equal((await bind(foreign)).rows[0]!.attribute_referral, false);
  const foreignSummary = await database.withWorkspace(foreign, tx => referralSummary(tx)) as { entries: unknown[] };
  assert.equal(foreignSummary.entries.length, 0);
  // Real separate pool connections race at the same remaining cap.
  await accrue('in_ref_cap_seed', 9948950000); // total exactly $1990 including earlier rewards
  await Promise.all([accrue('in_ref_cap_a', 100000000), accrue('in_ref_cap_b', 100000000, other)]);
  assert.equal((await client.query('SELECT sum(amount_micros)::text AS total FROM referral_credit_ledger WHERE workspace_id=$1', [referrer])).rows[0].total, '2000000000');

  await client.query("INSERT INTO workspace_billing(workspace_id,stripe_customer_id) VALUES($1,'cus_referral_test')", [referrer]);
  await client.query("UPDATE referral_credit_ledger SET available_at=now()-interval '1 day' WHERE stripe_invoice_id='in_ref_order'");
  const jobRow = (await client.query("UPDATE job SET status='running', attempt=1 WHERE payload->>'invoiceId'='in_ref_order' RETURNING id")).rows[0];
  const job: ClaimedJob = { id: jobRow.id, workspaceId: referrer, kind: 'issue_referral_credit', runId: null, payload: { invoiceId: 'in_ref_order' }, attempt: 1 };
  const original = globalThis.fetch;
  let posts = 0;
  try {
    globalThis.fetch = async (_input, options) => {
      posts++;
      assert.equal(new URLSearchParams(String(options?.body)).get('amount'), '-20');
      await refund('in_ref_order'); // while Stripe issuance is in flight
      return new Response(JSON.stringify({ id: 'cbtxn_ref_issue' }), { status: 200 });
    };
    await settleReferral(database, job, 'test-only');
    assert.equal((await client.query("SELECT status FROM referral_credit_ledger WHERE stripe_invoice_id='in_ref_order'")).rows[0].status, 'reversal_pending');
    await settleReferral(database, job, 'test-only');
    assert.equal(posts, 1, 'completed issue must not repost');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 500 });
    await assert.rejects(settleReferral(database, job, 'test-only', true), /settlement_failed/);
    assert.equal((await client.query("SELECT status FROM referral_credit_ledger WHERE stripe_invoice_id='in_ref_order'")).rows[0].status, 'reversal_pending');
    globalThis.fetch = async (_input, options) => {
      assert.equal(new URLSearchParams(String(options?.body)).get('amount'), '20');
      return new Response(JSON.stringify({ id: 'cbtxn_ref_reverse' }), { status: 200 });
    };
    await settleReferral(database, job, 'test-only', true);
    assert.equal((await client.query("SELECT status FROM referral_credit_ledger WHERE stripe_invoice_id='in_ref_order'")).rows[0].status, 'clawed_back');
    // Provider success followed by a DB failure: replay the SAME Stripe key,
    // with identical customer/amount, rather than create another balance entry.
    await client.query("UPDATE referral_credit_ledger SET available_at=now()-interval '1 day' WHERE stripe_invoice_id='in_ref_round'");
    const retryJob = { ...job, payload: { invoiceId: 'in_ref_round' } };
    let issued = 0;
    const keys = new Set<string>();
    globalThis.fetch = async (_input, options) => {
      const key = new Headers(options?.headers).get('idempotency-key')!;
      assert.match(String(_input), /customers\/cus_referral_test\/balance_transactions$/);
      if (!keys.has(key)) { keys.add(key); issued++; }
      return new Response(JSON.stringify({ id: 'cbtxn_retry' }), { status: 200 });
    };
    let failCommit = true;
    // Failure injected before commit; PostgreSQL rolls back the final update.
    const faultDatabase = {
      claimNextJob: database.claimNextJob.bind(database),
      withWorkspace: async <T>(workspace: string, fn: (tx: import('../src/foundation/database').TenantTransaction) => Promise<T>): Promise<T> =>
        database.withWorkspace(workspace, async tx => fn({ query: async (sql, values) => {
          const result = await tx.query(sql, values);
          if (failCommit && sql.includes('stripe_balance_txn = $2')) { failCommit = false; throw new Error('simulated_commit_failure'); }
          return result as never;
        } })),
    };
    await assert.rejects(settleReferral(faultDatabase, retryJob, 'test-only'), /simulated_commit_failure/);
    await client.query("UPDATE workspace_billing SET stripe_customer_id='cus_changed_after_issue' WHERE workspace_id=$1", [referrer]);
    await settleReferral(database, retryJob, 'test-only');
    assert.equal(issued, 1);
    await client.query("UPDATE referral_credit_ledger SET status='issuing', issuing_started_at=now()-interval '25 hours' WHERE stripe_invoice_id='in_ref_round'");
    globalThis.fetch = async () => { throw new Error('must not retry an expired idempotency key'); };
    await assert.rejects(settleReferral(database, retryJob, 'test-only'), /requires_reconciliation/);
  } finally { globalThis.fetch = original; }
  await refund('in_ref_order');
  const summary = await database.withWorkspace(referrer, tx => referralSummary(tx)) as { currencies: Array<{ credited: string; reversed: string }> };
  assert.equal(summary.currencies[0]?.credited, '210000');
  assert.equal(summary.currencies[0]?.reversed, '200000');
  await client.query('UPDATE referral_link SET revoked_at=now() WHERE code=$1', [code]);
  assert.equal((await bind(foreign)).rows[0]!.attribute_referral, false);
}
