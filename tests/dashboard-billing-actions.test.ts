import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages/BillingDashboard.tsx', import.meta.url), 'utf8');
test('current plan has an explicit upgrade action backed by the existing subscription portal', () => {
  const heading = source.indexOf('{data.usage.plan} plan');
  const upgrade = source.indexOf('>Upgrade Plan</button>');
  const details = source.indexOf('Subscription: {data.subscription');
  assert.ok(heading >= 0 && heading < upgrade && upgrade < details);
  assert.match(source, /act\('portal', \{ action: 'upgrade' \}\)/);
});
test('topup button uses server permission rather than excluding trial status and explains trial limits', () => {
  const button = source.split('\n').find(line => line.includes('>Add AI Credits</button>'));
  assert.ok(button);
  assert.match(button, /disabled=\{busy \|\| !data.canTopup\}/);
  assert.doesNotMatch(button, /trialing|subscriptionStatus/);
  assert.match(source, /Trial accounts can purchase credits/);
  assert.match(source, /do not extend the 7-day \/ 30-credit trial/);
});
