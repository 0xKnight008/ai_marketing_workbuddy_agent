import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages/BillingDashboard.tsx', import.meta.url), 'utf8');
test('current plan has an explicit upgrade action backed by the existing subscription portal', () => {
  const heading = source.indexOf('{data.usage.plan}');
  const upgrade = source.indexOf('t("Upgrade Plan")');
  const details = source.indexOf('t("Subscription:")');
  assert.ok(heading >= 0 && heading < upgrade && upgrade < details);
  assert.match(source, /act\('portal', \{ action: 'upgrade' \}\)/);
});
test('topup stays permission-based and trial copy explains the paid credit handoff', () => {
  const button = source.split('\n').find(line => line.includes('t("Add AI Credits")'));
  assert.ok(button);
  assert.match(button, /disabled=\{busy \|\| !data.canTopup\}/);
  assert.doesNotMatch(button, /trialing|subscriptionStatus/);
  assert.match(source, /Tasks use remaining trial credits first/);
  assert.match(source, /After payment succeeds, plan credits cover the difference/);
});
