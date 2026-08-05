import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { aiRuntimeEventSchema } from '../contracts/ai-runtime-event';
import type { ActorContext } from '../contracts/domain';
import { Database } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { PlatformOrm } from '../foundation/sequelize';
import { requirePermission } from '../foundation/rbac';
import { decryptSecret, encryptSecret } from '../foundation/secrets';
import { createWorkflowRun } from '../gateway/run-request';
import { createPublishedTemplate } from '../gateway/templates';
import { verifyAccessToken } from '../identity/token';
import { createDurableRun, decideApproval, ingestAiRuntimeEvent } from '../run-service/repository';
import { ZernioClient, type ZernioAccount } from '../zernio/client';
import { HttpError } from '../http/errors';

/** Framework-neutral orchestration used by Egg controllers and scheduled work. */
export class PlatformService {
  constructor(
    private readonly config: GatewayConfig,
    private readonly database: Database,
    private readonly orm: PlatformOrm,
  ) {}

  actorFrom(authorization: string | undefined): ActorContext {
    if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'unauthorized');
    try {
      return verifyAccessToken(authorization.slice('Bearer '.length), this.config.AUTH_TOKEN_SECRET);
    } catch {
      throw new HttpError(401, 'unauthorized');
    }
  }

  verifyAiRuntimeSignature(raw: Buffer, received: string | undefined): void {
    if (!received) throw new HttpError(401, 'unauthorized');
    const expected = createHmac('sha256', this.config.AI_RUNTIME_EVENT_SIGNING_SECRET).update(raw).digest();
    const actual = Buffer.from(received, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'unauthorized');
  }

  async ingestAiRuntimeEvent(body: unknown): Promise<void> {
    const event = aiRuntimeEventSchema.parse(body);
    await this.database.withWorkspace(event.workspaceId, (tx) => ingestAiRuntimeEvent(tx, event));
  }

  async createWorkflowRun(actor: ActorContext, body: unknown): Promise<{ runId: string; status: 'pending' }> {
    return createWorkflowRun(actor, body, {
      createRun: (context, request) => this.database.withWorkspace(context.workspaceId, async (tx) => {
        const run = await createDurableRun(tx, context, request);
        return { runId: run.id, status: 'pending' as const };
      }),
    });
  }

  async publishTemplate(actor: ActorContext, templateId: string): Promise<unknown> {
    const parsed = z.enum(['repurpose', 'weekly_report', 'comment_lead']).parse(templateId);
    return this.database.withWorkspace(actor.workspaceId, (tx) => createPublishedTemplate(tx, actor, parsed));
  }

  connectUrl(actor: ActorContext): string {
    requirePermission(actor.role, 'connection:manage');
    return this.zernioClient().connectUrl(actor.workspaceId);
  }

  async completeZernioOAuth(code: string, state: string): Promise<void> {
    const provider = this.zernioClient();
    const { workspaceId } = provider.verifyState(state);
    const token = await provider.exchangeCode(code);
    const accounts = await provider.listAccounts(token.accessToken);
    await this.storeZernioAccounts(workspaceId, token, accounts);
  }

  async syncZernio(actor: ActorContext): Promise<{ synced: number }> {
    requirePermission(actor.role, 'connection:manage');
    const credential = await this.zernioCredential(actor.workspaceId);
    const accounts = await this.zernioClient().listAccounts(credential.accessToken);
    await this.storeZernioAccounts(actor.workspaceId, credential, accounts);
    return { synced: accounts.length };
  }

  async pendingApprovals(actor: ActorContext): Promise<unknown[]> {
    requirePermission(actor.role, 'approval:decide');
    return this.orm.pendingApprovals(actor.workspaceId);
  }

  async run(actor: ActorContext, runId: string): Promise<unknown | undefined> {
    requirePermission(actor.role, 'workflow:run');
    const parsed = z.string().uuid().parse(runId);
    const result = await this.database.withWorkspace(actor.workspaceId, (tx) => tx.query<{ id: string; status: string; workflowId: string; createdAt: string }>(
      'SELECT id, status, workflow_id AS "workflowId", created_at::text AS "createdAt" FROM workflow_run WHERE id = $1 AND workspace_id = $2',
      [parsed, actor.workspaceId],
    ));
    return result.rows[0];
  }

  async decideApproval(actor: ActorContext, approvalId: string, decision: string, reason: unknown): Promise<unknown> {
    requirePermission(actor.role, 'approval:decide');
    const params = z.object({ approvalId: z.string().uuid(), decision: z.enum(['approved', 'rejected']) }).parse({ approvalId, decision });
    const body = z.object({ reason: z.string().max(1000).optional() }).parse({ reason });
    return this.database.withWorkspace(actor.workspaceId, (tx) => decideApproval(tx, actor, params.approvalId, params.decision, body.reason));
  }

  async taskEvents(actor: ActorContext): Promise<unknown[]> {
    requirePermission(actor.role, 'billing:view');
    const events = await this.database.withWorkspace(actor.workspaceId, (tx) => tx.query(
      'SELECT id, run_id AS "runId", action_type AS "actionType", billable_units AS "billableUnits", status, created_at AS "createdAt" FROM task_event WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100',
      [actor.workspaceId],
    ));
    return events.rows;
  }

  async auditEvents(actor: ActorContext): Promise<unknown[]> {
    requirePermission(actor.role, 'workspace:manage');
    const events = await this.database.withWorkspace(actor.workspaceId, (tx) => tx.query(
      'SELECT id, run_id AS "runId", event_type AS "eventType", payload, created_at AS "createdAt" FROM audit_event WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 100',
      [actor.workspaceId],
    ));
    return events.rows;
  }

  private zernioClient(): ZernioClient {
    if (!this.config.ZERNIO_BASE_URL || !this.config.ZERNIO_OAUTH_CLIENT_ID || !this.config.ZERNIO_OAUTH_REDIRECT_URI || !this.config.ZERNIO_OAUTH_STATE_SECRET) {
      throw new HttpError(503, 'provider_not_configured');
    }
    return new ZernioClient({
      baseUrl: this.config.ZERNIO_BASE_URL,
      oauthClientId: this.config.ZERNIO_OAUTH_CLIENT_ID,
      oauthRedirectUri: this.config.ZERNIO_OAUTH_REDIRECT_URI,
      oauthStateSecret: this.config.ZERNIO_OAUTH_STATE_SECRET,
    });
  }

  private async storeZernioAccounts(workspaceId: string, credential: { accessToken: string; refreshToken?: string }, accounts: ZernioAccount[]): Promise<void> {
    if (!this.config.SECRET_ENCRYPTION_KEY_BASE64) throw new HttpError(503, 'provider_not_configured');
    const encrypted = encryptSecret(JSON.stringify(credential), this.config.SECRET_ENCRYPTION_KEY_BASE64);
    await this.database.withWorkspace(workspaceId, async (tx) => {
      const stored = await tx.query<{ id: string }>(
        `INSERT INTO secret (workspace_id, purpose, ciphertext, iv, auth_tag, rotated_at)
         VALUES ($1, 'zernio.oauth', $2, $3, $4, now())
         ON CONFLICT (workspace_id, purpose) DO UPDATE
           SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag, rotated_at = now()
         RETURNING id`,
        [workspaceId, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
      );
      const secretId = stored.rows[0]?.id;
      if (!secretId) throw new Error('Zernio credential was not stored');
      for (const account of accounts) {
        await tx.query(
          `INSERT INTO connected_account (workspace_id, provider, external_account_id, display_name, secret_id, capabilities, status, last_synced_at)
           VALUES ($1, 'zernio', $2, $3, $4, $5, 'connected', now())
           ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE
             SET display_name = EXCLUDED.display_name, secret_id = EXCLUDED.secret_id, capabilities = EXCLUDED.capabilities,
                 status = 'connected', last_synced_at = now()`,
          [workspaceId, account.externalId, account.displayName, secretId, account.capabilities],
        );
      }
    });
  }

  private async zernioCredential(workspaceId: string): Promise<{ accessToken: string; refreshToken?: string }> {
    if (!this.config.SECRET_ENCRYPTION_KEY_BASE64) throw new HttpError(503, 'provider_not_configured');
    const stored = await this.database.withWorkspace(workspaceId, (tx) => tx.query<{ ciphertext: string; iv: string; authTag: string }>(
      "SELECT ciphertext, iv, auth_tag AS \"authTag\" FROM secret WHERE workspace_id = $1 AND purpose = 'zernio.oauth'",
      [workspaceId],
    ));
    const value = stored.rows[0];
    if (!value) throw new HttpError(404, 'connection_not_found');
    const parsed = JSON.parse(decryptSecret(value, this.config.SECRET_ENCRYPTION_KEY_BASE64)) as { accessToken?: unknown; refreshToken?: unknown };
    if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) throw new Error('Stored Zernio credential is invalid');
    return { accessToken: parsed.accessToken, refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined };
  }
}
