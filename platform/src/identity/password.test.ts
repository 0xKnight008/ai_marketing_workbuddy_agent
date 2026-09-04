import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword, verifyPassword } from './password';

test('password hashing round-trips and never stores the plaintext', () => {
  const hash = hashPassword('correct horse battery');
  assert.match(hash, /^scrypt:v1:16384:8:1:/);
  assert.ok(!hash.includes('correct horse'));
  assert.equal(verifyPassword('correct horse battery', hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
});

test('salts differ across hashes and malformed rows are rejected', () => {
  const a = hashPassword('same-password-1');
  const b = hashPassword('same-password-1');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('same-password-1', ''), false);
  assert.equal(verifyPassword('same-password-1', null), false);
  assert.equal(verifyPassword('same-password-1', 'bcrypt:v2:whatever'), false);
  assert.equal(verifyPassword('same-password-1', `${a}tampered`), false);
});

test('password policy enforces length bounds', () => {
  assert.throws(() => hashPassword('short'), /Password must be/);
  assert.throws(() => hashPassword('x'.repeat(129)), /Password must be/);
});
