import assert from 'node:assert/strict';
import test from 'node:test';
import { safeNextPath, checkoutAuthPath, requiresReauthentication } from '../src/lib/auth-navigation';
import { clearSessionAccessToken, readSessionAccessToken, storeSessionAccessToken } from '../src/lib/auth-session';

const origin = 'https://www.piggybot.me';
test('login return accepts a local checkout with plan and referral intact', () => {
  const next = '/activate?plan=growth&ref=ABCDEFGH';
  assert.equal(safeNextPath(`?next=${encodeURIComponent(next)}`, origin), next);
});

for (const next of ['//example.org', '/\\example.org', '/\n/example.org', '/foo/..//example.org', '/%2e%2e//example.org', 'https://example.org', 'javascript:alert(1)', '/login', '/register', '/app?next=/app']) {
  test(`rejects unsafe or looping return path ${JSON.stringify(next)}`, () => {
    assert.equal(safeNextPath(`?next=${encodeURIComponent(next)}`, origin), '');
  });
}

test('reauthentication preserves the newly selected plan, locale, and referral', () => {
  const url = new URL(checkoutAuthPath('/zh/activate', '?plan=creator&ref=ABCDEFGH', 'agency'), origin);
  assert.equal(url.pathname, '/login');
  assert.equal(url.searchParams.get('next'), '/zh/activate?plan=agency&ref=ABCDEFGH');
  assert.equal(requiresReauthentication(401), true);
  assert.equal(requiresReauthentication(403), false);
  assert.equal(requiresReauthentication(500), false);
});

test('expired and malformed stored tokens return to login; valid tokens still require server verification', (t) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  const token = (exp: number) => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
  storeSessionAccessToken(token(1));
  assert.equal(readSessionAccessToken(), '');
  assert.equal(values.size, 0);
  storeSessionAccessToken('bad-token');
  assert.equal(readSessionAccessToken(), '');
  const current = token(Date.now() / 1000 + 60);
  storeSessionAccessToken(current);
  assert.equal(readSessionAccessToken(), current);
  clearSessionAccessToken();
  assert.equal(readSessionAccessToken(), '');
});
