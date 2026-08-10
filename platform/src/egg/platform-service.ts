import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { aiRuntimeEventSchema } from '../contracts/ai-runtime-event';
import { PLAN_KEYS } from '../billing/plans';
import { activateStripeSubscription, resumeBillingPausedRuns, updateEntitlement, updateStripeSubscriptionStatus, usageSnapshot } from '../billing/guardrails';
import { createStripeCheckoutSession, retrieveStripeSubscription, stripeActivationFromWebhook, stripeSubscriptionStatusFromWebhook, verifyStripeWebhookSignature } from '../billing/stripe';
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

  async createStripeCheckout(actor: ActorContext, body: unknown): Promise<{ id: string; url: string }> {
    if (actor.role !== 'owner') throw new HttpError(403, 'owner_required');
    const parsed = z.object({ plan: z.enum(PLAN_KEYS) }).parse(body);
    const checkout = await createStripeCheckoutSession(this.config, {
      workspaceId: actor.workspaceId,
      actorId: actor.actorId,
      plan: parsed.plan,
    });
    await this.database.withWorkspace(actor.workspaceId, (tx) => tx.query(
      'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
      [actor.workspaceId, actor.actorId, 'billing.stripe_checkout_started', { plan: parsed.plan, stripeCheckoutSessionId: checkout.id }],
    ));
    return checkout;
  }

  async ingestStripeWebhook(rawBody: string, signature: string | undefined): Promise<{ received: true; activated: boolean }> {
    if (!this.config.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'stripe_not_configured');
    verifyStripeWebhookSignature(rawBody, signature, this.config.STRIPE_WEBHOOK_SECRET, this.config.STRIPE_WEBHOOK_TOLERANCE_SECONDS);
    const activation = stripeActivationFromWebhook(rawBody);
    if (activation) {
      const subscription = activation.subscriptionId
        ? await retrieveStripeSubscription(this.config, activation.subscriptionId)
        : undefined;
      if (subscription?.workspaceId && subscription.workspaceId !== activation.workspaceId) {
        throw new HttpError(400, 'stripe_workspace_mismatch');
      }
      const hydrated = {
        ...activation,
        customerId: subscription?.customerId ?? activation.customerId,
        subscriptionId: subscription?.id ?? activation.subscriptionId,
        priceId: subscription?.priceId ?? activation.priceId,
        subscriptionStatus: subscription?.status ?? activation.subscriptionStatus,
        trialEndsAt: subscription?.trialEndsAt,
      };
      const result = await this.database.withWorkspace(hydrated.workspaceId, async (tx) => {
        const applied = await activateStripeSubscription(tx, hydrated);
        if (applied.applied) {
          await tx.query('INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)', [
            hydrated.workspaceId,
            'billing.stripe_activated',
            { plan: hydrated.plan, stripeEventId: hydrated.eventId, stripeSubscriptionId: hydrated.subscriptionId },
          ]);
        }
        return applied;
      });
      return { received: true, activated: result.applied };
    }

    const statusEvent = stripeSubscriptionStatusFromWebhook(rawBody, this.config.STRIPE_PAYMENT_GRACE_DAYS);
    if (!statusEvent) return { received: true, activated: false };
    const subscription = statusEvent.workspaceId ? undefined : await retrieveStripeSubscription(this.config, statusEvent.subscriptionId);
    const workspaceId = statusEvent.workspaceId ?? subscription?.workspaceId;
    if (!workspaceId) throw new HttpError(400, 'stripe_workspace_metadata_missing');
    const result = await this.database.withWorkspace(workspaceId, async (tx) => {
      const applied = await updateStripeSubscriptionStatus(tx, {
        ...statusEvent,
        customerId: subscription?.customerId ?? statusEvent.customerId,
        subscriptionId: subscription?.id ?? statusEvent.subscriptionId,
      });
      if (applied.applied) {
        await tx.query('INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)', [
          workspaceId,
          'billing.stripe_subscription_status_changed',
          { eventType: statusEvent.eventType, stripeEventId: statusEvent.eventId, stripeSubscriptionId: statusEvent.subscriptionId, status: statusEvent.subscriptionStatus },
        ]);
      }
      return applied;
    });
    return { received: true, activated: result.applied };
  }

  async billingUsage(actor: ActorContext): Promise<unknown> {
    requirePermission(actor.role, 'billing:view');
    return this.database.withWorkspace(actor.workspaceId, usageSnapshot);
  }

  async updateBillingEntitlements(actor: ActorContext, adminToken: string | undefined, body: unknown): Promise<unknown> {
    if (!this.config.BILLING_ADMIN_TOKEN || adminToken !== this.config.BILLING_ADMIN_TOKEN) {
      throw new HttpError(403, 'billing_admin_required');
    }
    const parsed = z.object({
      plan: z.enum(PLAN_KEYS).optional(),
      additionalAiCredits: z.number().int().nonnegative().refine((value) => value % 1_000 === 0, 'additionalAiCredits must be a multiple of 1000').default(0),
    }).parse(body ?? {});
    if (!parsed.plan && parsed.additionalAiCredits === 0) throw new HttpError(400, 'entitlement_change_required');
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const current = await usageSnapshot(tx);
      const usage = await updateEntitlement(tx, parsed.plan ?? current.plan, parsed.additionalAiCredits);
      const resumedRuns = usage.status === 'paused' ? 0 : await resumeBillingPausedRuns(tx);
      await tx.query('INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)', [
        actor.workspaceId,
        actor.actorId,
        'billing.entitlement_updated',
        { plan: usage.plan, additionalAiCredits: parsed.additionalAiCredits, resumedRuns },
      ]);
      return { usage, resumedRuns };
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
