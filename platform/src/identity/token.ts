import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ActorContext, WorkspaceRole } from '../contracts/domain';

export interface AccessTokenClaims extends ActorContext {
  exp: number;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueAccessToken(claims: AccessTokenClaims, secret: string): string {
  if (secret.length < 32) throw new Error('AUTH_TOKEN_SECRET must be at least 32 characters');
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  return `${header}.${payload}.${sign(`${header}.${payload}`, secret)}`;
}

export function verifyAccessToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): AccessTokenClaims {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw new Error('Malformed access token');
  const expected = sign(`${header}.${payload}`, secret);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid access token signature');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<AccessTokenClaims>;
  if (!claims.actorId || !claims.workspaceId || !claims.role || !claims.exp || claims.exp <= nowSeconds) throw new Error('Expired or incomplete access token');
  if (!['owner', 'admin', 'editor', 'approver', 'viewer'].includes(claims.role as WorkspaceRole)) throw new Error('Invalid workspace role');
  return claims as AccessTokenClaims;
}
