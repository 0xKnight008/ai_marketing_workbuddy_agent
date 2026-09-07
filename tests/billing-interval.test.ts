import assert from 'node:assert/strict';
import test from 'node:test';
import { billingCopy, selectedBillingInterval } from '../src/lib/billing-interval';
import { checkoutAuthPath, safeNextPath } from '../src/lib/auth-navigation';

test('annual selection survives initial sign-in and expired-session reauthentication', () => {
  for (const lang of ['en', 'zh', 'es']) {
    const redirect = new URL(checkoutAuthPath(`/${lang}/activate`, '?plan=creator&billingInterval=month&ref=ABCDEFGH', 'agency', 'year'), 'https://www.piggybot.me');
    const next = safeNextPath(redirect.search, redirect.origin);
    const checkout = new URL(next, redirect.origin);
    assert.equal(checkout.pathname, `/${lang}/activate`);
    assert.equal(checkout.searchParams.get('plan'), 'agency');
    assert.equal(checkout.searchParams.get('ref'), 'ABCDEFGH');
    assert.equal(selectedBillingInterval(checkout.search), 'year');
  }
});

test('monthly remains the default and explicit monthly selection overwrites a previous annual link', () => {
  assert.equal(selectedBillingInterval(''), 'month');
  assert.equal(selectedBillingInterval('?billingInterval=week'), 'month');
  const redirect = new URL(checkoutAuthPath('/activate', '?billingInterval=year', 'growth', 'month'), 'https://www.piggybot.me');
  assert.equal(selectedBillingInterval(new URL(redirect.searchParams.get('next')!, redirect.origin).search), 'month');
});

test('all locales explain annual price confirmation without invented prices', () => {
  for (const copy of Object.values(billingCopy)) {
    assert.ok(copy.month && copy.year && copy.annualPrice && copy.annualNote);
    assert.doesNotMatch(copy.annualPrice, /\$/);
  }
});
