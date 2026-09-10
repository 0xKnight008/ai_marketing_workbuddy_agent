import { z } from 'zod';
import type { ActorContext } from '../contracts/domain';
import type { Database, TenantTransaction } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { can } from '../foundation/rbac';
import { HttpError } from '../http/errors';
import { PLAN_CATALOG, type PlanKey } from './plans';
import { usageSnapshot } from './guardrails';

const metadataSchema = z.object({ workspaceId: z.string().uuid(), purpose: z.literal('ai_credit_topup') });
const checkoutSchema = z.object({ id: z.string(), mode: z.literal('payment'), status: z.literal('complete'), payment_status: z.literal('paid'), currency: z.literal('usd'),
  customer: z.string(), payment_intent: z.string(), amount_total: z.number().int().min(1000).max(100000), amount_subtotal: z.number().int(), metadata: metadataSchema,
  line_items: z.object({ has_more: z.literal(false), data: z.array(z.object({ quantity: z.literal(1), price: z.object({ id: z.string() }) })).length(1) }) });
type Binding = { customerId: string | null; subscriptionId: string | null; balance: string; debt: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const date = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;

/** Monetary conversion is integer-only: one USD cent buys one AI credit. */
export function creditsForPayment(cents: number): number {
  if (!Number.isInteger(cents) || cents < 1000 || cents > 100000) throw new HttpError(400, 'topup_amount_out_of_range');
  return cents;
}

export async function applyCreditTopup(tx: TenantTransaction, input: { sessionId: string; paymentIntentId: string; amountCents: number }): Promise<boolean> {
  const credits = creditsForPayment(input.amountCents);
  const added = await tx.query(`INSERT INTO credit_topup (checkout_session_id, workspace_id, payment_intent_id, amount_cents, credits)
    VALUES ($1, current_setting('app.workspace_id')::uuid, $2, $3, $3) ON CONFLICT (checkout_session_id) DO NOTHING RETURNING checkout_session_id`, [input.sessionId, input.paymentIntentId, credits]);
  if (!added.rowCount) return false;
  await tx.query(`UPDATE workspace_billing SET purchased_ai_credits = purchased_ai_credits + GREATEST(0, $1 - credit_refund_debt),
    credit_refund_debt = GREATEST(0, credit_refund_debt - $1), updated_at = now() WHERE workspace_id = current_setting('app.workspace_id')::uuid`, [credits]);
  return true;
}

export async function applyCreditRefund(tx: TenantTransaction, paymentIntentId: string, refundedCents: number): Promise<void> {
  if (!Number.isInteger(refundedCents) || refundedCents < 0) throw new HttpError(400, 'topup_refund_invalid');
  const result = await tx.query<{ refunded: number; amount: number }>(`SELECT refunded_cents AS refunded, amount_cents AS amount FROM credit_topup
    WHERE workspace_id = current_setting('app.workspace_id')::uuid AND payment_intent_id = $1 FOR UPDATE`, [paymentIntentId]);
  const topup = result.rows[0];
  if (!topup) throw new HttpError(409, 'topup_refund_waiting_for_payment');
  const delta = Math.max(0, Math.min(refundedCents, topup.amount) - topup.refunded);
  if (!delta) return;
  await tx.query(`UPDATE workspace_billing SET credit_refund_debt = credit_refund_debt + GREATEST(0, $1 - purchased_ai_credits),
    purchased_ai_credits = GREATEST(0, purchased_ai_credits - $1) WHERE workspace_id = current_setting('app.workspace_id')::uuid`, [delta]);
  await tx.query('UPDATE credit_topup SET refunded_cents = refunded_cents + $2 WHERE payment_intent_id = $1', [paymentIntentId, delta]);
}

export class CustomerBillingService {
  constructor(private readonly config: GatewayConfig, private readonly database: Database) {}

  private owner(actor: ActorContext) { if (actor.role !== 'owner') throw new HttpError(403, 'owner_required'); }
  private async stripe(path: string, body?: URLSearchParams): Promise<Record<string, unknown>> {
    if (!this.config.STRIPE_SECRET_KEY) throw new HttpError(503, 'stripe_not_configured');
    const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${this.config.STRIPE_SECRET_KEY}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new HttpError(502, 'stripe_billing_unavailable');
    return record(await response.json());
  }
  private async binding(tx: TenantTransaction): Promise<Binding> {
    await usageSnapshot(tx);
    const result = await tx.query<Binding>(`SELECT stripe_customer_id AS "customerId", stripe_subscription_id AS "subscriptionId",
      purchased_ai_credits::text AS balance, credit_refund_debt::text AS debt FROM workspace_billing
      WHERE workspace_id = current_setting('app.workspace_id')::uuid FOR UPDATE`);
    if (!result.rows[0]) throw new HttpError(409, 'billing_record_missing');
    return result.rows[0];
  }

  async overview(actor: ActorContext): Promise<unknown> {
    if (!can(actor.role, 'billing:view')) throw new HttpError(403, 'billing_view_forbidden');
    return this.database.withWorkspace(actor.workspaceId, async (tx) => {
      const binding = await this.binding(tx);
      let subscription: Record<string, unknown> | null = null;
      let syncError = false;
      if (binding.subscriptionId) {
        try {
          const value = await this.stripe(`subscriptions/${encodeURIComponent(binding.subscriptionId)}`);
          if (value.id !== binding.subscriptionId || value.customer !== binding.customerId || record(value.metadata).workspaceId !== actor.workspaceId) throw new HttpError(409, 'stripe_workspace_mismatch');
          const items = record(value.items).data;
          const item = record(Array.isArray(items) ? items[0] : undefined);
          const price = record(item.price);
          const plan = this.planForPrice(price.id);
          if (!plan || typeof value.status !== 'string') throw new HttpError(503, 'stripe_price_not_mapped');
          subscription = { status: value.status, plan, priceId: price.id, renewsAt: date(value.current_period_end ?? item.current_period_end), trialEndsAt: date(value.trial_end),
            cancelAtPeriodEnd: value.cancel_at_period_end === true, cancelAt: date(value.cancel_at), amountCents: price.unit_amount, currency: price.currency, interval: record(price.recurring).interval };
        } catch { syncError = true; }
      }
      if (subscription) await tx.query(`UPDATE workspace_billing SET plan = $1, stripe_price_id = $2, subscription_status = $3,
        trial_ends_at = $4::timestamptz, updated_at = now() WHERE workspace_id = current_setting('app.workspace_id')::uuid`,
        [subscription.plan, subscription.priceId, subscription.status, subscription.trialEndsAt]);
      const usage = await usageSnapshot(tx);
      const history = await tx.query(`SELECT checkout_session_id AS id, amount_cents AS "amountCents", credits, refunded_cents AS "refundedCents", created_at AS "createdAt"
        FROM credit_topup WHERE workspace_id = current_setting('app.workspace_id')::uuid ORDER BY created_at DESC LIMIT 20`);
      return { usage, subscription, syncError, creditBalance: Number(binding.balance), refundDebt: Number(binding.debt),
        includedCredits: usage.subscriptionStatus === 'trialing' ? 30 : PLAN_CATALOG[usage.plan].aiCredits, topups: history.rows,
        canManage: actor.role === 'owner' && !!binding.customerId,
        canUpgrade: actor.role === 'owner' && !!binding.customerId && !!binding.subscriptionId,
        canTopup: actor.role === 'owner' && !!binding.customerId && !!this.config.STRIPE_PRICE_AI_CREDITS,
        topupUnavailableReason: actor.role !== 'owner' ? 'owner_required' : !binding.customerId ? 'stripe_customer_not_linked' : !this.config.STRIPE_PRICE_AI_CREDITS ? 'credit_topup_not_configured' : null };
    });
  }

  planForPrice(priceId: unknown): PlanKey | undefined {
    const ids: [PlanKey, unknown][] = [['creator', this.config.STRIPE_PRICE_CREATOR], ['creator', this.config.STRIPE_PRICE_CREATOR_YEARLY], ['growth', this.config.STRIPE_PRICE_GROWTH], ['growth', this.config.STRIPE_PRICE_GROWTH_YEARLY], ['agency', this.config.STRIPE_PRICE_AGENCY], ['agency', this.config.STRIPE_PRICE_AGENCY_YEARLY]];
    return typeof priceId === 'string' ? ids.find(([, id]) => id === priceId)?.[0] : undefined;
  }

  async portal(actor: ActorContext, input: unknown = {}): Promise<{ url: string }> {
    this.owner(actor);
    const { action } = z.object({ action: z.enum(['manage', 'upgrade']).default('manage') }).parse(input ?? {});
    const binding = await this.database.withWorkspace(actor.workspaceId, (tx) => this.binding(tx));
    if (!binding.customerId) throw new HttpError(409, 'stripe_customer_not_linked');
    const body = new URLSearchParams({ customer: binding.customerId, return_url: `${this.config.PUBLIC_SITE_URL.replace(/\/$/, '')}/app?section=dashboard` });
    if (action === 'upgrade') {
      if (!binding.subscriptionId) throw new HttpError(409, 'stripe_subscription_not_linked');
      body.set('flow_data[type]', 'subscription_update');
      body.set('flow_data[subscription_update][subscription]', binding.subscriptionId);
      body.set('flow_data[after_completion][type]', 'redirect');
      body.set('flow_data[after_completion][redirect][return_url]', body.get('return_url')!);
    }
    const value = await this.stripe('billing_portal/sessions', body);
    return { url: this.redirect(value.url, 'billing.stripe.com') };
  }

  private redirect(value: unknown, host: string): string {
    if (typeof value !== 'string') throw new HttpError(502, 'stripe_redirect_invalid');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== host) throw new HttpError(502, 'stripe_redirect_invalid');
    return value;
  }

  async startTopup(actor: ActorContext): Promise<{ url: string }> {
    this.owner(actor);
    const priceId = this.config.STRIPE_PRICE_AI_CREDITS;
    if (!priceId) throw new HttpError(503, 'credit_topup_not_configured');
    const price = await this.stripe(`prices/${encodeURIComponent(priceId)}`);
    const custom = record(price.custom_unit_amount);
    if (price.active !== true || price.type !== 'one_time' || price.currency !== 'usd' || custom.minimum !== 1000 || custom.maximum !== 100000) throw new HttpError(503, 'credit_topup_price_invalid');
    const binding = await this.database.withWorkspace(actor.workspaceId, (tx) => this.binding(tx));
    if (!binding.customerId) throw new HttpError(409, 'stripe_customer_not_linked');
    const site = this.config.PUBLIC_SITE_URL.replace(/\/$/, '');
    const body = new URLSearchParams({ mode: 'payment', customer: binding.customerId, 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1',
      'payment_method_types[0]': 'card', 'metadata[workspaceId]': actor.workspaceId, 'metadata[purpose]': 'ai_credit_topup',
      'payment_intent_data[metadata][workspaceId]': actor.workspaceId, 'payment_intent_data[metadata][purpose]': 'ai_credit_topup',
      success_url: `${site}/app?section=dashboard&topup_session={CHECKOUT_SESSION_ID}`, cancel_url: `${site}/app?section=dashboard&topup=cancelled` });
    const session = await this.stripe('checkout/sessions', body);
    return { url: this.redirect(session.url, 'checkout.stripe.com') };
  }

  async confirmTopup(actor: ActorContext, input: unknown): Promise<{ credited: boolean }> {
    this.owner(actor);
    const { sessionId } = z.object({ sessionId: z.string().regex(/^cs_[a-zA-Z0-9_]+$/).max(255) }).parse(input);
    return this.creditSession(sessionId, actor.workspaceId);
  }

  private async creditSession(sessionId: string, workspaceId: string): Promise<{ credited: boolean }> {
    const session = checkoutSchema.parse(await this.stripe(`checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`));
    if (session.id !== sessionId || session.metadata.workspaceId !== workspaceId || session.line_items.data[0]?.price.id !== this.config.STRIPE_PRICE_AI_CREDITS || session.amount_subtotal !== session.amount_total) throw new HttpError(409, 'credit_topup_mismatch');
    return this.database.withWorkspace(workspaceId, async (tx) => {
      const binding = await this.binding(tx);
      if (binding.customerId !== session.customer) throw new HttpError(403, 'stripe_workspace_mismatch');
      const credited = await applyCreditTopup(tx, { sessionId, paymentIntentId: session.payment_intent, amountCents: session.amount_total });
      return { credited };
    });
  }

  /** Called only AFTER the shared Stripe signature verification. */
  async webhook(rawBody: string): Promise<boolean> {
    const event = JSON.parse(rawBody) as { type: string; data: { object: Record<string, unknown> } };
    const value = event.data.object;
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && record(value.metadata).purpose === 'ai_credit_topup') {
      const metadata = metadataSchema.parse(value.metadata);
      if (typeof value.id !== 'string') throw new HttpError(400, 'credit_topup_invalid');
      if (value.payment_status !== 'paid') return true;
      await this.creditSession(value.id, metadata.workspaceId);
      return true;
    }
    if (event.type === 'charge.refunded' && typeof value.payment_intent === 'string') {
      const intent = await this.stripe(`payment_intents/${encodeURIComponent(value.payment_intent)}`);
      if (record(intent.metadata).purpose !== 'ai_credit_topup') return false;
      const metadata = metadataSchema.parse(intent.metadata);
      const charge = await this.stripe(`charges/${encodeURIComponent(String(value.id))}`);
      if (charge.payment_intent !== value.payment_intent || charge.currency !== 'usd') throw new HttpError(409, 'credit_refund_mismatch');
      await this.database.withWorkspace(metadata.workspaceId, async (tx) => { await this.binding(tx); await applyCreditRefund(tx, value.payment_intent as string, Number(charge.amount_refunded)); });
      return true;
    }
    return false;
  }
}
