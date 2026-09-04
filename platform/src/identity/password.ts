import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with the Node built-in scrypt KDF so the platform keeps
 * zero additional dependencies. The serialized format is self-describing so
 * parameters can be rotated later without a migration:
 *   scrypt:v1:<N>:<r>:<p>:<salt_base64url>:<hash_base64url>
 */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`);
  }
}

export function hashPassword(password: string): string {
  assertPasswordPolicy(password);
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:v1:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof password !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 7) return false;
  const [scheme, version, n, r, p, salt, expected] = parts;
  if (scheme !== 'scrypt' || version !== 'v1' || !n || !r || !p || !salt || !expected) return false;
  const derived = scryptSync(password, Buffer.from(salt, 'base64url'), KEY_LENGTH, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
}
