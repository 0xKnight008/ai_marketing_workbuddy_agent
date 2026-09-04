import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import type { ActorContext } from '../contracts/domain';
import { Database } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { HttpError } from '../http/errors';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password';
import { issueAccessToken } from './token';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});
const registerSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(80).optional(),
});

export interface AuthSession {
  accessToken: string;
  expiresAt: string;
  workspaceId: string;
  role: string;
}

export interface MeView {
  user: { email: string; displayName: string; passwordSet: boolean };
  workspace: { id: string; name: string };
  role: string;
  plan: string;
  subscriptionStatus: string;
}

/** Fixed-window guard against credential stuffing on the public auth routes. */
class AttemptLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  check(key: string): void {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) throw new HttpError(429, 'rate_limited');
    recent.push(now);
    this.hits.set(key, recent);
  }
}

let dummyHash: string | undefined;

/** Email + password sign-in for the console; billing stays owned by PlatformService. */
export class EmailAuthService {
  private readonly loginLimiter = new AttemptLimiter(10, 10 * 60_000);
  private readonly registerLimiter = new AttemptLimiter(5, 10 * 60_000);

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: Database,
  ) {}

  async register(body: unknown, clientKey: string): Promise<AuthSession> {
    this.registerLimiter.check(clientKey);
    const input = registerSchema.parse(body);
    try {
      assertPasswordPolicy(input.password);
    } catch {
      throw new HttpError(400, 'password_policy');
    }
    const passwordHash = hashPassword(input.password);
    const displayName = input.displayName ?? (input.email.split('@')[0] ?? 'user').slice(0, 80);

    const created = await this.database.withAdmin(async (tx) => {
      const existing = await tx.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [input.email]);
      if (existing.rows[0]) throw new HttpError(409, 'email_already_registered');
      const user = await tx.query<{ id: string }>(
        'INSERT INTO app_user (email, display_name, password_hash, password_updated_at) VALUES ($1, $2, $3, now()) RETURNING id',
        [input.email, displayName, passwordHash],
      );
      const userRow = user.rows[0];
      if (!userRow) throw new Error('user_insert_failed');
      const userId = userRow.id;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const workspace = await tx.query<{ id: string }>(
            'INSERT INTO workspace (name, slug) VALUES ($1, $2) RETURNING id',
            [`${displayName}'s workspace`, workspaceSlug(input.email)],
          );
          const workspaceRow = workspace.rows[0];
          if (!workspaceRow) throw new Error('workspace_insert_failed');
          const workspaceId = workspaceRow.id;
          await tx.query(
            "INSERT INTO workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
            [workspaceId, userId],
          );
          return { userId, workspaceId };
        } catch (error) {
          if (attempt === 2 || !isUniqueViolation(error)) throw error;
        }
      }
      throw new Error('workspace_slug_exhausted');
    });

    await this.database.withWorkspace(created.workspaceId, (tx) => tx.query(
      'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
      [created.workspaceId, created.userId, 'identity.email_registered', {}],
    ));
    return this.issueSession(created.userId, created.workspaceId, 'owner');
  }

  async login(body: unknown, clientKey: string): Promise<AuthSession> {
    const input = credentialsSchema.parse(body);
    this.loginLimiter.check(`${clientKey}:${input.email}`);
    const account = await this.database.withAdmin(async (tx) => {
      const user = await tx.query<{ id: string; passwordHash: string | null }>(
        'SELECT id, password_hash AS "passwordHash" FROM app_user WHERE email = $1',
        [input.email],
      );
      const row = user.rows[0];
      // Verify against a throwaway hash when the email is unknown so the timing
      // side channel does not reveal which addresses hold accounts.
      const passwordOk = verifyPassword(input.password, row?.passwordHash ?? (dummyHash ??= hashPassword(randomBytes(16).toString('hex'))));
      if (!row || !passwordOk) throw new HttpError(401, 'invalid_credentials');
      const membership = await tx.query<{ workspaceId: string; role: string }>(
        `SELECT m.workspace_id AS "workspaceId", m.role::text AS role
           FROM workspace_membership m
          WHERE m.user_id = $1
          ORDER BY CASE WHEN m.role = 'owner' THEN 0 WHEN m.role = 'admin' THEN 1 ELSE 2 END, m.created_at
          LIMIT 1`,
        [row.id],
      );
      const seat = membership.rows[0];
      if (!seat) throw new HttpError(403, 'workspace_missing');
      return { userId: row.id, workspaceId: seat.workspaceId, role: seat.role };
    });
    await this.database.withWorkspace(account.workspaceId, (tx) => tx.query(
      'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
      [account.workspaceId, account.userId, 'identity.email_login', {}],
    ));
    return this.issueSession(account.userId, account.workspaceId, account.role);
  }

  /** Console bootstrap: identity plus the billing flag that drives feature gating. */
  async me(actor: ActorContext): Promise<MeView> {
    const view = await this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const result = await tx.query<{
        email: string; displayName: string; passwordSet: boolean;
        workspaceId: string; workspaceName: string; role: string;
        plan: string | null; subscriptionStatus: string | null;
      }>(
        `SELECT u.email::text AS email, u.display_name AS "displayName",
                (u.password_hash IS NOT NULL) AS "passwordSet",
                w.id AS "workspaceId", w.name AS "workspaceName", m.role::text AS role,
                b.plan, b.subscription_status AS "subscriptionStatus"
           FROM workspace_membership m
           JOIN app_user u ON u.id = m.user_id
           JOIN workspace w ON w.id = m.workspace_id
           LEFT JOIN workspace_billing b ON b.workspace_id = m.workspace_id
          WHERE m.workspace_id = $1 AND m.user_id = $2`,
        [actor.workspaceId, actor.actorId],
      );
      return result.rows[0];
    });
    if (!view) throw new HttpError(403, 'workspace_missing');
    return {
      user: { email: view.email, displayName: view.displayName, passwordSet: view.passwordSet },
      workspace: { id: view.workspaceId, name: view.workspaceName },
      role: view.role,
      plan: view.plan ?? 'creator',
      subscriptionStatus: view.subscriptionStatus ?? 'inactive',
    };
  }

  /** Lets activation-ticket users attach a password so email sign-in works later. */
  async setPassword(actor: ActorContext, body: unknown): Promise<{ passwordSet: true }> {
    const { password } = z.object({ password: z.string().min(8).max(128) }).parse(body);
    try {
      assertPasswordPolicy(password);
    } catch {
      throw new HttpError(400, 'password_policy');
    }
    const passwordHash = hashPassword(password);
    await this.database.withWorkspace(actor.workspaceId, async (tx) => {
      await tx.query(
        'UPDATE app_user SET password_hash = $1, password_updated_at = now() WHERE id = $2',
        [passwordHash, actor.actorId],
      );
      await tx.query(
        'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [actor.workspaceId, actor.actorId, 'identity.password_set', {}],
      );
    });
    return { passwordSet: true };
  }

  private issueSession(userId: string, workspaceId: string, role: string): AuthSession {
    const expiresAtSeconds = Math.floor(Date.now() / 1_000) + this.config.AUTH_SESSION_TTL_SECONDS;
    return {
      accessToken: issueAccessToken({
        actorId: userId,
        workspaceId,
        role: role as ActorContext['role'],
        exp: expiresAtSeconds,
      }, this.config.AUTH_TOKEN_SECRET),
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
      workspaceId,
      role,
    };
  }
}

function workspaceSlug(email: string): string {
  const local = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 20) || 'user';
  return `${local}-${randomBytes(4).toString('hex')}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
