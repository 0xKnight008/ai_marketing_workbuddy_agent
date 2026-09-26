import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutReferral } from '../src/lib/referral-context';

test('explicit referral wins; deferred cross-host checkout recovers the site cookie', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/api/referral/context');
    assert.equal(options?.credentials, 'same-origin');
    return new Response(JSON.stringify({ referralCode: 'ABCDEFGH' }));
  };
  try {
    assert.equal(await checkoutReferral('JKLMNPQR', 'test'), 'JKLMNPQR');
    assert.equal(calls, 0);
    assert.equal(await checkoutReferral(undefined, 'test'), 'ABCDEFGH');
    globalThis.fetch = async () => new Response(JSON.stringify({ referralCode: 'not-valid' }));
    assert.equal(await checkoutReferral(undefined, 'test'), undefined);
  } finally { globalThis.fetch = original; }
});
