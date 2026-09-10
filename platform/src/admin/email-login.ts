import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ActorContext } from '../contracts/domain';
import type { Database } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { HttpError } from '../http/errors';

const principals = new WeakMap<ActorContext, { email: string; sessionId: string }>();
export const adminPrincipal = (actor: ActorContext) => principals.get(actor);
export const ADMIN_COOKIE = '__Host-piggybot_admin';
export const ADMIN_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/', signed: false, overwrite: true };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const NIL = '00000000-0000-4000-8000-000000000000';

export class AdminEmailLogin {
  constructor(private readonly config: GatewayConfig, private readonly database: Database) {}
  private allowed(email: string) { return (this.config.PLATFORM_ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).includes(email); }
  assertOrigin(origin: string | undefined) {
    if (!origin || origin !== new URL(this.config.PUBLIC_SITE_URL).origin) throw new HttpError(403, 'admin_origin_forbidden');
  }
  async requestLink(input: unknown, clientIp: string): Promise<void> {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(input);
    const permitted = await this.database.withAdmin(async tx => {
      await tx.query('DELETE FROM platform_admin_login_limit WHERE expires_at < now()');
      const results = [];
      for (const [key, limit] of [[`ip:${clientIp}`, 5], [`email:${email}`, 2]] as const) {
        const row = await tx.query<{ attempts: number }>(`INSERT INTO platform_admin_login_limit(key, attempts, expires_at) VALUES ($1, 1, now() + interval '15 minutes')
          ON CONFLICT(key) DO UPDATE SET attempts = platform_admin_login_limit.attempts + 1 RETURNING attempts`, [hash(key)]);
        results.push((row.rows[0]?.attempts ?? Infinity) <= limit);
      }
      return results.every(Boolean);
    });
    if (!permitted || !this.allowed(email)) return;
    if (!this.config.RESEND_API_KEY || !(this.config.RESEND_FROM_EMAIL || this.config.FEEDBACK_FROM_EMAIL)) return;
    const site = new URL(this.config.PUBLIC_SITE_URL);
    if (site.protocol !== 'https:') throw new HttpError(503, 'admin_https_required');
    const ticket = randomBytes(32).toString('base64url');
    const tokenHash = hash(ticket);
    await this.database.withAdmin(tx => tx.query(`INSERT INTO platform_admin_link(token_hash,email,expires_at) VALUES($1,$2,now()+interval '10 minutes')`, [tokenHash, email]));
    const link = new URL('/app/admin', site); link.hash = `admin_ticket=${ticket}`;
    try {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${this.config.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `admin-login/${tokenHash}` },
        body: JSON.stringify({ from: this.config.RESEND_FROM_EMAIL || this.config.FEEDBACK_FROM_EMAIL, to: [email], subject: 'Piggybot admin sign-in',
          text: `Use this one-time link to sign in to Piggybot administration. It expires in 10 minutes.\n\n${link.href}\n\nIf you did not request this email, ignore it. Never share this link.` }), signal: AbortSignal.timeout(10000) });
      if (!response.ok || !z.object({ id: z.string().min(1) }).safeParse(await response.json()).success) throw new Error('email_rejected');
      await this.audit(email, 'admin.login_link_sent');
    } catch {
      await this.database.withAdmin(tx => tx.query('UPDATE platform_admin_link SET consumed_at=now() WHERE token_hash=$1', [tokenHash]));
      await this.audit(email, 'admin.login_link_delivery_failed');
    }
  }
  async exchange(input: unknown): Promise<string> {
    const { ticket } = z.object({ ticket: tokenSchema }).parse(input);
    const session = randomBytes(32).toString('base64url');
    return this.database.withAdmin(async tx => {
      const result = await tx.query<{ email: string }>(`UPDATE platform_admin_link SET consumed_at=now() WHERE token_hash=$1
        AND consumed_at IS NULL AND expires_at > now() RETURNING email`, [hash(ticket)]);
      const email = result.rows[0]?.email;
      if (!email || !this.allowed(email)) throw new HttpError(401, 'admin_link_invalid_or_expired');
      await tx.query(`INSERT INTO platform_admin_session(token_hash,email,expires_at) VALUES($1,$2,now()+interval '30 minutes')`, [hash(session), email]);
      await tx.query(`INSERT INTO platform_admin_audit(email,event_type) VALUES($1,'admin.signed_in')`, [email]);
      return session;
    });
  }
  async authenticate(session: string): Promise<ActorContext> {
    if (!tokenSchema.safeParse(session).success) throw new HttpError(401, 'admin_session_required');
    const result = await this.database.withAdmin(tx => tx.query<{ id: string; email: string }>(`SELECT id,email FROM platform_admin_session
      WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()`, [hash(session)]));
    const row = result.rows[0];
    if (!row || !this.allowed(row.email)) throw new HttpError(401, 'admin_session_required');
    const actor: ActorContext = { actorId: `admin:${row.email}`, workspaceId: NIL, role: 'admin' };
    principals.set(actor, { email: row.email, sessionId: row.id });
    return actor;
  }
  async logout(session: string): Promise<void> {
    if (!tokenSchema.safeParse(session).success) return;
    await this.database.withAdmin(tx => tx.query('UPDATE platform_admin_session SET revoked_at=now() WHERE token_hash=$1', [hash(session)]));
  }
  private async audit(email: string, event: string) { await this.database.withAdmin(tx => tx.query('INSERT INTO platform_admin_audit(email,event_type) VALUES($1,$2)', [email, event])); }
}
