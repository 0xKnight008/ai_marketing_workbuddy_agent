import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { AdminService } from '../admin/service';
import { aiRuntimeEventSchema } from '../contracts/ai-runtime-event';
import { PLAN_KEYS } from '../billing/plans';
import { activateStripeSubscription, updateStripeSubscriptionStatus, usageSnapshot } from '../billing/guardrails';
import { createStripeCheckoutSession, retrieveStripeSubscription, stripeActivationFromWebhook, stripeInvoicePaidFromWebhook, stripeSubscriptionStatusFromWebhook, verifyStripeWebhookSignature } from '../billing/stripe';
import type { ActorContext } from '../contracts/domain';
import { Database } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { PlatformOrm } from '../foundation/sequelize';
import { requirePermission } from '../foundation/rbac';
import { decryptSecret, encryptSecret } from '../foundation/secrets';
import { createWorkflowRun } from '../gateway/run-request';
import { createPublishedTemplate } from '../gateway/templates';
import {
  activatePipeline,
  createPipelineDraft,
  inspectPipelineReadiness,
  listConnectedAccounts,
  listPipelines,
  listPipelineTemplates,
  updatePipelineDraft,
} from '../gateway/pipelines';
import { verifyAccessToken } from '../identity/token';
import { ActivationDeliveryService } from '../identity/activation';
import { createDurableRun, decideApproval, ingestAiRuntimeEvent } from '../run-service/repository';
import {
  ZERNIO_PLATFORMS,
  ZernioClient,
  type ZernioAccount,
  type ZernioPlatform,
  type ZernioSelectionContext,
  type ZernioSelectionOption,
} from '../zernio/client';
import { HttpError } from '../http/errors';
import { activeReferralLink, referralSummary } from '../referral/service';

/** Framework-neutral orchestration used by Egg controllers and scheduled work. */
export class PlatformService {
  private readonly activationDelivery: ActivationDeliveryService;
  private readonly admin: AdminService;

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: Database,
    private readonly orm: PlatformOrm,
  ) {
    this.activationDelivery = new ActivationDeliveryService(config, database);
    this.admin = new AdminService(config, database);
  }

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

  async exchangeActivationTicket(body: unknown): Promise<unknown> {
    return this.activationDelivery.exchangeTicket(body);
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
    const parsed = z.object({ plan: z.enum(PLAN_KEYS), referralCode: z.string().regex(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/).optional() }).parse(body);
    const checkout = await createStripeCheckoutSession(this.config, {
      workspaceId: actor.workspaceId,
      actorId: actor.actorId,
      plan: parsed.plan,
      referralCode: parsed.referralCode,
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
        const referralCode = referralCodeFromWebhook(rawBody);
        if (applied.applied && referralCode) {
          await tx.query('SELECT attribute_referral($1, $2::uuid, $3)', [referralCode, hydrated.workspaceId, 'checkout']);
        }
        if (applied.applied) {
          await tx.query('INSERT INTO audit_event (workspace_id, event_type, payload) VALUES ($1, $2, $3)', [
            hydrated.workspaceId,
            'billing.stripe_activated',
            { plan: hydrated.plan, stripeEventId: hydrated.eventId, stripeSubscriptionId: hydrated.subscriptionId },
          ]);
        }
        return applied;
      });
      await this.activationDelivery.deliverCheckout(hydrated);
      return { received: true, activated: result.applied };
    }

    const invoice = stripeInvoicePaidFromWebhook(rawBody);
    if (invoice) {
      await this.database.withWorkspace(invoice.workspaceId, (tx) => tx.query(
        'SELECT accrue_referral_credit($1, $2::uuid, $3::bigint, $4)',
        [invoice.invoiceId, invoice.workspaceId, invoice.paidMicros, invoice.currency],
      ));
      return { received: true, activated: false };
    }

    const refundedInvoiceId = refundedInvoiceFromWebhook(rawBody);
    if (refundedInvoiceId) {
      // The security-definer function locates the referrer workspace safely.
      await this.database.withWorkspace('00000000-0000-4000-8000-000000000000', (tx) => tx.query('SELECT queue_referral_clawback($1)', [refundedInvoiceId]));
      return { received: true, activated: false };
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

  async referralLink(actor: ActorContext): Promise<{ code: string; url: string }> {
    requirePermission(actor.role, 'referral:manage');
    const link = await this.database.withWorkspace(actor.workspaceId, activeReferralLink);
    return { ...link, url: `${this.config.PUBLIC_SITE_URL.replace(/\/$/, '')}/r/${link.code}` };
  }

  async referralSummary(actor: ActorContext): Promise<unknown> {
    requirePermission(actor.role, 'referral:view');
    return this.database.withWorkspace(actor.workspaceId, referralSummary);
  }

  async updateBillingEntitlements(actor: ActorContext, adminToken: string | undefined, body: unknown): Promise<unknown> {
    return this.admin.updateEntitlements(actor, adminToken, actor.workspaceId, body);
  }

  async adminWorkspaces(actor: ActorContext, adminToken: string | undefined, query: unknown): Promise<unknown[]> {
    return this.admin.workspaces(actor, adminToken, query);
  }

  async adminUpdateEntitlements(actor: ActorContext, adminToken: string | undefined, workspaceId: unknown, body: unknown): Promise<unknown> {
    return this.admin.updateEntitlements(actor, adminToken, workspaceId, body);
  }

  async adminFeedback(actor: ActorContext, adminToken: string | undefined, query: unknown): Promise<unknown[]> {
    return this.admin.feedback(actor, adminToken, query);
  }

  async adminUpdateFeedback(actor: ActorContext, adminToken: string | undefined, ticketNo: unknown, body: unknown): Promise<unknown> {
    return this.admin.updateFeedback(actor, adminToken, ticketNo, body);
  }

  async adminDeadLetterJobs(actor: ActorContext, adminToken: string | undefined, query: unknown): Promise<unknown[]> {
    return this.admin.deadLetterJobs(actor, adminToken, query);
  }

  async adminReplayJob(actor: ActorContext, adminToken: string | undefined, jobId: unknown, body: unknown): Promise<unknown> {
    return this.admin.replayJob(actor, adminToken, jobId, body);
  }

  async adminReferrals(actor: ActorContext, adminToken: string | undefined, query: unknown): Promise<unknown[]> {
    return this.admin.referrals(actor, adminToken, query);
  }

  async adminVoidReferral(actor: ActorContext, adminToken: string | undefined, ledgerId: unknown, body: unknown): Promise<unknown> {
    return this.admin.voidReferral(actor, adminToken, ledgerId, body);
  }

  async publishTemplate(actor: ActorContext, templateId: string): Promise<unknown> {
    const parsed = z.enum(['repurpose', 'weekly_report', 'comment_lead']).parse(templateId);
    return this.database.withWorkspace(actor.workspaceId, (tx) => createPublishedTemplate(tx, actor, parsed));
  }

  pipelineTemplates(actor: ActorContext): unknown[] {
    requirePermission(actor.role, 'workflow:run');
    return listPipelineTemplates();
  }

  async pipelines(actor: ActorContext): Promise<unknown[]> {
    return this.database.withWorkspace(actor.workspaceId, (tx) => listPipelines(tx, actor));
  }

  async createPipeline(actor: ActorContext, body: unknown): Promise<unknown> {
    return this.database.withWorkspace(actor.workspaceId, (tx) => createPipelineDraft(tx, actor, body));
  }

  async updatePipeline(actor: ActorContext, pipelineId: string, body: unknown): Promise<unknown> {
    return this.database.withWorkspace(actor.workspaceId, (tx) => updatePipelineDraft(tx, actor, pipelineId, body));
  }

  async testPipeline(actor: ActorContext, pipelineId: string): Promise<unknown> {
    return this.database.withWorkspace(actor.workspaceId, (tx) => inspectPipelineReadiness(tx, actor, pipelineId));
  }

  async activatePipeline(actor: ActorContext, pipelineId: string): Promise<unknown> {
    return this.database.withWorkspace(actor.workspaceId, (tx) => activatePipeline(tx, actor, pipelineId));
  }

  async connectedAccounts(actor: ActorContext): Promise<unknown[]> {
    return this.database.withWorkspace(actor.workspaceId, (tx) => listConnectedAccounts(tx, actor));
  }

  async connectUrl(actor: ActorContext, requestedPlatform: unknown): Promise<string> {
    requirePermission(actor.role, 'connection:manage');
    const platform = z.enum(ZERNIO_PLATFORMS).parse(requestedPlatform) as ZernioPlatform;
    const profileId = await this.ensureZernioProfile(actor.workspaceId);
    return this.zernioClient().connectUrl(actor.workspaceId, profileId, platform);
  }

  async completeZernioOAuth(query: Record<string, unknown>): Promise<
    | { kind: 'connected' }
    | { kind: 'selection'; platform: ZernioPlatform; choices: Array<{ label: string; detail?: string; token: string }> }
  > {
    if (typeof query.error === 'string') throw new HttpError(400, 'zernio_connection_denied');
    const provider = this.zernioClient();
    if (typeof query.state !== 'string') throw new HttpError(400, 'invalid_request');
    const state = provider.verifyState(query.state);
    const mappedProfileId = await this.zernioProfile(state.workspaceId);
    if (mappedProfileId !== state.profileId) throw new HttpError(403, 'zernio_tenant_mismatch');
    const callback = provider.parseHeadlessCallback(query);
    if (callback) {
      if (callback.profileId !== state.profileId || callback.platform !== state.platform) throw new HttpError(403, 'zernio_tenant_mismatch');
      const context: ZernioSelectionContext = { ...callback, workspaceId: state.workspaceId, expiresAt: Math.floor(Date.now() / 1000) + 600 };
      const selection = await provider.listSelections(context);
      if (!selection.options.length) throw new HttpError(409, 'zernio_no_eligible_accounts');
      return {
        kind: 'selection',
        platform: state.platform,
        choices: selection.options.map((option) => ({
          label: option.label,
          detail: option.detail,
          token: this.sealZernioSelection(selection.context, option),
        })),
      };
    }
    if (typeof query.profileId === 'string' && query.profileId !== state.profileId) throw new HttpError(403, 'zernio_tenant_mismatch');
    const accounts = await provider.listAccounts(state.profileId, state.workspaceId);
    await this.storeZernioAccounts(state.workspaceId, state.profileId, accounts);
    return { kind: 'connected' };
  }

  async selectZernioAccount(token: unknown): Promise<void> {
    const { context, option } = this.openZernioSelection(z.string().min(1).parse(token));
    const mappedProfileId = await this.zernioProfile(context.workspaceId);
    if (mappedProfileId !== context.profileId) throw new HttpError(403, 'zernio_tenant_mismatch');
    await this.zernioClient().select(context, option);
    const accounts = await this.zernioClient().listAccounts(context.profileId, context.workspaceId);
    await this.storeZernioAccounts(context.workspaceId, context.profileId, accounts);
  }

  async syncZernio(actor: ActorContext): Promise<{ synced: number }> {
    requirePermission(actor.role, 'connection:manage');
    const profileId = await this.zernioProfile(actor.workspaceId);
    const accounts = await this.zernioClient().listAccounts(profileId, actor.workspaceId);
    await this.storeZernioAccounts(actor.workspaceId, profileId, accounts);
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

  async createFeedback(actor: ActorContext, body: unknown): Promise<{ ticketId: string }> {
    const input = z.object({
      category: z.enum(['billing', 'bug', 'feature', 'other']).default('other'),
      message: z.string().max(2_000),
      locale: z.enum(['zh', 'en', 'es']).optional(),
      pageUrl: z.string().url().max(2_048).optional(),
      name: z.string().max(120).optional(),
    }).parse(body ?? {});
    const message = feedbackText(input.message, 2_000);
    if (!message) throw new HttpError(400, 'invalid_message');
    const name = input.name ? feedbackText(input.name, 120) || undefined : undefined;

    const feedback = await this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const member = await tx.query<{ email: string }>(
        `SELECT u.email::text AS email
           FROM app_user u JOIN workspace_membership m ON m.user_id = u.id
          WHERE m.workspace_id = $1 AND m.user_id = $2`,
        [actor.workspaceId, actor.actorId],
      );
      const email = member.rows[0]?.email;
      if (!email) throw new HttpError(403, 'workspace_membership_required');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const ticketId = `FB-${randomBytes(4).toString('hex').toUpperCase()}`;
        try {
          await tx.query(
            `INSERT INTO feedback_message (ticket_no, source, workspace_id, email, name, category, message, locale, page_url)
             VALUES ($1, 'platform', $2, $3, $4, $5, $6, $7, $8)`,
            [ticketId, actor.workspaceId, email, name, input.category, message, input.locale, input.pageUrl],
          );
          return { ticketId, email, name, category: input.category, message };
        } catch (error) {
          if ((error as { code?: string }).code !== '23505' || attempt === 2) throw error;
        }
      }
      throw new Error('ticket_generation_failed');
    });
    try {
      await this.notifyDiscordFeedback(feedback);
    } catch (error) {
      console.error('Discord support notification failed', { ticketId: feedback.ticketId, message: error instanceof Error ? error.message : 'unknown_error' });
    }
    return { ticketId: feedback.ticketId };
  }

  private zernioClient(): ZernioClient {
    if (!this.config.ZERNIO_BASE_URL || !this.config.ZERNIO_API_KEY || !this.config.ZERNIO_OAUTH_REDIRECT_URI || !this.config.ZERNIO_OAUTH_STATE_SECRET) {
      throw new HttpError(503, 'provider_not_configured');
    }
    return new ZernioClient({
      baseUrl: this.config.ZERNIO_BASE_URL,
      apiKey: this.config.ZERNIO_API_KEY,
      oauthRedirectUri: this.config.ZERNIO_OAUTH_REDIRECT_URI,
      oauthStateSecret: this.config.ZERNIO_OAUTH_STATE_SECRET,
      globalRequestsPerMinute: this.config.ZERNIO_CLIENT_RPM,
    });
  }

  private async notifyDiscordFeedback(feedback: { ticketId: string; email: string; name?: string; category: string; message: string }): Promise<void> {
    if (!this.config.DISCORD_BOT_TOKEN || !this.config.DISCORD_FEEDBACK_CHANNEL_ID) return;
    const headers = { Authorization: `Bot ${this.config.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };
    const posted = await fetch(`https://discord.com/api/v10/channels/${this.config.DISCORD_FEEDBACK_CHANNEL_ID}/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ content: `**${feedback.ticketId}** · ${feedback.category}\n${feedback.email}${feedback.name ? ` (${feedback.name})` : ''}\n\n${feedback.message}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!posted.ok) throw new Error(`discord_message_failed_${posted.status}`);
    const message = await posted.json() as { id?: string };
    if (!message.id) throw new Error('discord_message_missing_id');
    const thread = await fetch(`https://discord.com/api/v10/channels/${this.config.DISCORD_FEEDBACK_CHANNEL_ID}/messages/${message.id}/threads`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: `${feedback.ticketId} · ${feedback.category}`, auto_archive_duration: 1440 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!thread.ok) throw new Error(`discord_thread_failed_${thread.status}`);
    await thread.json();
  }

  private async ensureZernioProfile(workspaceId: string): Promise<string> {
    const existing = await this.database.withWorkspace(workspaceId, (tx) => tx.query<{ profileId: string }>(
      'SELECT profile_id AS "profileId" FROM zernio_tenant WHERE workspace_id = $1', [workspaceId],
    ));
    if (existing.rows[0]?.profileId) return existing.rows[0].profileId;
    const profileId = await this.zernioClient().createProfile(workspaceId);
    const stored = await this.database.withWorkspace(workspaceId, (tx) => tx.query<{ profileId: string }>(
      `INSERT INTO zernio_tenant (workspace_id, profile_id)
       VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE SET updated_at = now()
       RETURNING profile_id AS "profileId"`,
      [workspaceId, profileId],
    ));
    const persisted = stored.rows[0]?.profileId;
    if (!persisted || persisted !== profileId) throw new Error('Zernio tenant profile was not stored');
    return persisted;
  }

  private async zernioProfile(workspaceId: string): Promise<string> {
    const result = await this.database.withWorkspace(workspaceId, (tx) => tx.query<{ profileId: string }>(
      'SELECT profile_id AS "profileId" FROM zernio_tenant WHERE workspace_id = $1', [workspaceId],
    ));
    const profileId = result.rows[0]?.profileId;
    if (!profileId) throw new HttpError(404, 'connection_not_found');
    return profileId;
  }

  private sealZernioSelection(context: ZernioSelectionContext, option: ZernioSelectionOption): string {
    if (!this.config.SECRET_ENCRYPTION_KEY_BASE64) throw new HttpError(503, 'provider_not_configured');
    const encrypted = encryptSecret(JSON.stringify({ context, option }), this.config.SECRET_ENCRYPTION_KEY_BASE64);
    return Buffer.from(JSON.stringify(encrypted)).toString('base64url');
  }

  private openZernioSelection(token: string): { context: ZernioSelectionContext; option: ZernioSelectionOption } {
    if (!this.config.SECRET_ENCRYPTION_KEY_BASE64) throw new HttpError(503, 'provider_not_configured');
    try {
      const encrypted = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { ciphertext: string; iv: string; authTag: string };
      const value = JSON.parse(decryptSecret(encrypted, this.config.SECRET_ENCRYPTION_KEY_BASE64)) as { context: ZernioSelectionContext; option: ZernioSelectionOption };
      if (!value.context || !value.option || value.context.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('expired');
      return value;
    } catch {
      throw new HttpError(400, 'invalid_or_expired_zernio_selection');
    }
  }

  private async storeZernioAccounts(workspaceId: string, profileId: string, accounts: ZernioAccount[]): Promise<void> {
    await this.database.withWorkspace(workspaceId, async (tx) => {
      for (const account of accounts) {
        await tx.query(
          `INSERT INTO connected_account (workspace_id, provider, external_account_id, display_name, capabilities, status, last_synced_at, zernio_profile_id, platform)
           VALUES ($1, 'zernio', $2, $3, $4, 'connected', now(), $5, $6)
           ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE
             SET display_name = EXCLUDED.display_name, capabilities = EXCLUDED.capabilities,
                 status = 'connected', last_synced_at = now(), zernio_profile_id = EXCLUDED.zernio_profile_id,
                 platform = EXCLUDED.platform`,
          [workspaceId, account.externalId, account.displayName, account.capabilities, profileId, account.platform ?? 'unknown'],
        );
      }
      await tx.query(
        `UPDATE connected_account SET status = 'disconnected', last_synced_at = now()
          WHERE workspace_id = $1 AND provider = 'zernio' AND zernio_profile_id = $2
            AND NOT (external_account_id = ANY($3::text[]))`,
        [workspaceId, profileId, accounts.map((account) => account.externalId)],
      );
    });
  }
}

function feedbackText(value: string, maxLength: number): string {
  return value.normalize('NFKC').replace(/<[^>]*>/g, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength + 1);
}

function referralCodeFromWebhook(rawBody: string): string | undefined {
  try {
    const value = JSON.parse(rawBody) as { data?: { object?: { metadata?: { referral_code?: unknown } } } };
    const code = value.data?.object?.metadata?.referral_code;
    return typeof code === 'string' && /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(code) ? code : undefined;
  } catch { return undefined; }
}

function refundedInvoiceFromWebhook(rawBody: string): string | undefined {
  try {
    const value = JSON.parse(rawBody) as { type?: string; data?: { object?: { invoice?: unknown } } };
    return value.type === 'charge.refunded' && typeof value.data?.object?.invoice === 'string' ? value.data.object.invoice : undefined;
  } catch { return undefined; }
}
