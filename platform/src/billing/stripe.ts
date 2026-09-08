import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { GatewayConfig } from '../foundation/platform-config';
import { HttpError } from '../http/errors';
import { PLAN_KEYS, type PlanKey } from './plans';
import type { ActorContext } from '../contracts/domain';

const planSchema = z.enum(PLAN_KEYS);
export const billingIntervalSchema = z.enum(['month', 'year']);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface StripeActivationEvent {
  eventId: string;
  eventType: string;
  workspaceId: string;
  actorId: string;
  plan: PlanKey;
  customerId?: string;
  subscriptionId?: string;
  priceId?: string;
  subscriptionStatus: string;
  trialEndsAt?: string;
  trialStartsAt?: string;
}

export interface StripeSubscriptionStatusEvent {
  eventId: string;
  eventType: 'customer.subscription.deleted' | 'customer.subscription.updated' | 'invoice.payment_failed';
  workspaceId?: string;
  subscriptionId: string;
  customerId?: string;
  subscriptionStatus: string;
  paymentGraceEndsAt?: string;
}

export interface StripeInvoicePaidEvent { invoiceId: string; workspaceId: string; paidMicros: number; currency: string; }

export function stripeInvoicePaidFromWebhook(rawBody: string): StripeInvoicePaidEvent | undefined {
  const event = stripeEventFromWebhook(rawBody);
  if (event.type !== 'invoice.paid') return undefined;
  const invoice = event.data.object;
  const details = recordValue(invoice.subscription_details) ?? recordValue(recordValue(invoice.parent)?.subscription_details);
  const workspaceId = workspaceMetadata(details?.metadata ?? invoice.metadata)?.workspaceId;
  const invoiceId = stringValue(invoice.id);
  const amountPaid = typeof invoice.amount_paid === 'number' && Number.isInteger(invoice.amount_paid) ? invoice.amount_paid : undefined;
  const currency = stringValue(invoice.currency) ?? 'usd';
  if (!workspaceId || !invoiceId || !amountPaid || amountPaid <= 0) return undefined;
  return { invoiceId, workspaceId, paidMicros: amountPaid * 10_000, currency };
}

interface StripeSubscription {
  id: string;
  customerId?: string;
  status: string;
  trialEndsAt?: string;
  trialStartsAt?: string;
  priceId?: string;
  workspaceId?: string;
}

function stripeConfiguration(config: GatewayConfig, plan: PlanKey, billingInterval: BillingInterval) {
  const priceIds: Record<PlanKey, string | undefined> = {
    creator: billingInterval === 'year' ? config.STRIPE_PRICE_CREATOR_YEARLY : config.STRIPE_PRICE_CREATOR,
    growth: billingInterval === 'year' ? config.STRIPE_PRICE_GROWTH_YEARLY : config.STRIPE_PRICE_GROWTH,
    agency: billingInterval === 'year' ? config.STRIPE_PRICE_AGENCY_YEARLY : config.STRIPE_PRICE_AGENCY,
  };
  const priceId = priceIds[plan];
  if (!config.STRIPE_SECRET_KEY || !priceId) {
    throw new HttpError(503, 'stripe_not_configured');
  }
  return { secretKey: config.STRIPE_SECRET_KEY, priceId };
}

function stripeSecret(config: GatewayConfig): string {
  if (!config.STRIPE_SECRET_KEY) throw new HttpError(503, 'stripe_not_configured');
  return config.STRIPE_SECRET_KEY;
}

export async function createStripeCheckoutSession(config: GatewayConfig, input: { workspaceId: string; actorId: string; plan: PlanKey; billingInterval?: BillingInterval; referralCode?: string }): Promise<StripeCheckoutSession> {
  const billingInterval = billingIntervalSchema.default('month').parse(input.billingInterval);
  const stripe = stripeConfiguration(config, input.plan, billingInterval);
  if (billingInterval === 'year') {
    // A misconfigured annual variable must not silently sell a monthly or
    // one-time Price. This is a read, before creating the Checkout Session.
    const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(stripe.priceId)}`, {
      headers: { authorization: `Bearer ${stripe.secretKey}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!priceResponse.ok) throw new HttpError(502, 'stripe_price_lookup_failed');
    const price = await priceResponse.json() as { active?: boolean; recurring?: { interval?: string; interval_count?: number } };
    if (!price.active || price.recurring?.interval !== 'year' || price.recurring.interval_count !== 1) {
      throw new HttpError(503, 'stripe_annual_price_invalid');
    }
  }
  const body = new URLSearchParams();
  body.set('mode', 'subscription');
  body.set('line_items[0][price]', stripe.priceId);
  body.set('line_items[0][quantity]', '1');
  body.set('client_reference_id', input.workspaceId);
  body.set('metadata[workspaceId]', input.workspaceId);
  body.set('metadata[actorId]', input.actorId);
  body.set('metadata[plan]', input.plan);
  body.set('metadata[billingInterval]', billingInterval);
  if (input.referralCode) body.set('metadata[referral_code]', input.referralCode);
  body.set('subscription_data[metadata][workspaceId]', input.workspaceId);
  body.set('subscription_data[metadata][plan]', input.plan);
  body.set('subscription_data[metadata][billingInterval]', billingInterval);
  body.set('subscription_data[trial_period_days]', String(config.STRIPE_TRIAL_DAYS));
  const returnParams = new URLSearchParams({ plan: input.plan, billingInterval });
  if (input.referralCode) returnParams.set('ref', input.referralCode);
  body.set('success_url', `${config.PUBLIC_SITE_URL.replace(/\/$/, '')}/activate?checkout=success&${returnParams}&session_id={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', `${config.PUBLIC_SITE_URL.replace(/\/$/, '')}/activate?checkout=cancelled&${returnParams}`);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${stripe.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await response.json().catch(() => ({})) as { id?: unknown; url?: unknown; error?: { message?: unknown } };
  if (!response.ok || typeof payload.id !== 'string' || typeof payload.url !== 'string') {
    throw new HttpError(502, 'stripe_checkout_failed', typeof payload.error?.message === 'string' ? payload.error.message : 'Stripe Checkout could not be created');
  }
  return { id: payload.id, url: payload.url };
}

export function verifyStripeWebhookSignature(rawBody: string, header: string | undefined, secret: string, toleranceSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (!header) throw new HttpError(401, 'stripe_signature_missing');
  const parts = header.split(',').map((part) => part.split('=', 2));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value).filter((value): value is string => Boolean(value));
  const timestampNumber = Number(timestamp);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > toleranceSeconds || signatures.length === 0) {
    throw new HttpError(401, 'stripe_signature_invalid');
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const valid = signatures.some((signature) => {
    const received = Buffer.from(signature, 'utf8');
    return received.length === expectedBytes.length && timingSafeEqual(received, expectedBytes);
  });
  if (!valid) throw new HttpError(401, 'stripe_signature_invalid');
}

export function stripeActivationFromWebhook(rawBody: string): StripeActivationEvent | undefined {
  const event = stripeEventFromWebhook(rawBody);
  if (event.type !== 'checkout.session.completed') return undefined;
  const session = event.data.object;
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return undefined;
  const metadata = workspaceMetadata(session.metadata);
  if (!metadata?.plan || !metadata.actorId) return undefined;
  return {
    eventId: event.id,
    eventType: event.type,
    workspaceId: metadata.workspaceId,
    actorId: metadata.actorId,
    plan: metadata.plan,
    customerId: stringValue(session.customer),
    subscriptionId: stringValue(session.subscription),
    priceId: undefined,
    // Checkout only supplies a subscription id. The service hydrates this from
    // Stripe before persisting so trial expiry always matches Stripe's clock.
    subscriptionStatus: 'active',
  };
}

/** Extracts lifecycle changes; callers may resolve metadata from Stripe when an invoice omits it. */
export function stripeSubscriptionStatusFromWebhook(
  rawBody: string,
  paymentGraceDays: number,
  now = new Date(),
): StripeSubscriptionStatusEvent | undefined {
  const event = stripeEventFromWebhook(rawBody);
  const object = event.data.object;
  if (event.type === 'customer.subscription.deleted') {
    const subscriptionId = stringValue(object.id);
    if (!subscriptionId) return undefined;
    return {
      eventId: event.id,
      eventType: event.type,
      workspaceId: workspaceMetadata(object.metadata)?.workspaceId,
      subscriptionId,
      customerId: stringValue(object.customer),
      subscriptionStatus: 'inactive',
    };
  }
  if (event.type === 'customer.subscription.updated') {
    const subscriptionId = stringValue(object.id);
    const status = stringValue(object.status);
    if (!subscriptionId || !status) return undefined;
    return {
      eventId: event.id,
      eventType: event.type,
      workspaceId: workspaceMetadata(object.metadata)?.workspaceId,
      subscriptionId,
      customerId: stringValue(object.customer),
      subscriptionStatus: normalizedSubscriptionStatus(status),
    };
  }
  if (event.type !== 'invoice.payment_failed') return undefined;
  const parent = recordValue(object.parent);
  const subscriptionDetails = recordValue(object.subscription_details) ?? recordValue(parent?.subscription_details);
  const subscriptionId = stringValue(object.subscription) ?? stringValue(subscriptionDetails?.subscription);
  if (!subscriptionId) return undefined;
  return {
    eventId: event.id,
    eventType: event.type,
    workspaceId: workspaceMetadata(subscriptionDetails?.metadata ?? object.metadata)?.workspaceId,
    subscriptionId,
    customerId: stringValue(object.customer),
    subscriptionStatus: 'past_due',
    paymentGraceEndsAt: new Date(now.getTime() + paymentGraceDays * 86_400_000).toISOString(),
  };
}

/** Retrieves authoritative subscription status and trial end from Stripe. */
export async function retrieveStripeSubscription(config: GatewayConfig, subscriptionId: string): Promise<StripeSubscription> {
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { authorization: `Bearer ${stripeSecret(config)}` },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new HttpError(502, 'stripe_subscription_fetch_failed');
  const id = stringValue(payload.id);
  const status = stringValue(payload.status);
  if (!id || !status) throw new HttpError(502, 'stripe_subscription_fetch_failed');
  const itemData = recordValue(payload.items)?.data;
  const firstItem = Array.isArray(itemData) ? recordValue(itemData[0]) : undefined;
  const priceId = stringValue(recordValue(firstItem?.price)?.id);
  return {
    id,
    customerId: stringValue(payload.customer),
    status,
    trialEndsAt: unixTimestampToIso(payload.trial_end),
    trialStartsAt: unixTimestampToIso(payload.trial_start),
    priceId,
    workspaceId: workspaceMetadata(payload.metadata)?.workspaceId,
  };
}

/** The browser supplies only an opaque ID; ownership and entitlement come from Stripe. */
export async function retrieveCheckoutActivation(config: GatewayConfig, sessionId: string, actor: ActorContext): Promise<StripeActivationEvent> {
  if (actor.role !== 'owner') throw new HttpError(403, 'owner_required');
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) throw new HttpError(400, 'stripe_session_invalid');
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${stripeSecret(config)}` }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new HttpError(502, 'stripe_checkout_fetch_failed');
  const session = await response.json() as Record<string, unknown>;
  const metadata = workspaceMetadata(session.metadata);
  if (session.id !== sessionId || metadata?.workspaceId !== actor.workspaceId || !metadata.plan || !metadata.actorId) throw new HttpError(403, 'stripe_workspace_mismatch');
  if (session.mode !== 'subscription' || session.status !== 'complete' || !['paid', 'no_payment_required'].includes(String(session.payment_status))) throw new HttpError(409, 'stripe_checkout_not_complete');
  const subscriptionId = stringValue(session.subscription);
  if (!subscriptionId) throw new HttpError(409, 'stripe_subscription_missing');
  const subscription = await retrieveStripeSubscription(config, subscriptionId);
  if (subscription.workspaceId !== actor.workspaceId || subscription.customerId !== stringValue(session.customer)) throw new HttpError(403, 'stripe_workspace_mismatch');
  if (subscription.status !== 'active' && !(subscription.status === 'trialing' && Date.parse(subscription.trialEndsAt ?? '') > Date.now())) throw new HttpError(409, 'stripe_subscription_not_entitled');
  return {
    eventId: `checkout-return:${sessionId}`, eventType: 'checkout.session.reconciled',
    workspaceId: actor.workspaceId, actorId: metadata.actorId, plan: metadata.plan,
    subscriptionId, customerId: subscription.customerId, priceId: subscription.priceId,
    subscriptionStatus: subscription.status, trialEndsAt: subscription.trialEndsAt, trialStartsAt: subscription.trialStartsAt,
  };
}

/** Inspect the workspace's recorded Checkout without creating a second customer/subscription. */
export async function inspectRecordedCheckout(config: GatewayConfig, sessionId: string, actor: ActorContext): Promise<{ state: 'complete' | 'expired' | 'open'; url?: string }> {
  if (actor.role !== 'owner') throw new HttpError(403, 'owner_required');
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) throw new HttpError(400, 'stripe_session_invalid');
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${stripeSecret(config)}` }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new HttpError(502, 'stripe_checkout_fetch_failed');
  const session = await response.json() as Record<string, unknown>;
  if (session.id !== sessionId || workspaceMetadata(session.metadata)?.workspaceId !== actor.workspaceId || session.mode !== 'subscription') throw new HttpError(403, 'stripe_workspace_mismatch');
  if (session.status === 'complete') return { state: 'complete' };
  if (session.status === 'expired') return { state: 'expired' };
  if (session.status === 'open' && typeof session.url === 'string') {
    const url = new URL(session.url);
    if (url.protocol === 'https:' && url.hostname === 'checkout.stripe.com') return { state: 'open', url: session.url };
  }
  throw new HttpError(409, 'stripe_checkout_not_complete');
}

function stripeEventFromWebhook(rawBody: string): StripeEvent {
  return z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z.object({ object: z.record(z.unknown()) }),
  }).parse(JSON.parse(rawBody)) as StripeEvent;
}

function workspaceMetadata(value: unknown): { workspaceId: string; actorId?: string; plan?: PlanKey } | undefined {
  const parsed = z.object({
    workspaceId: z.string().uuid(),
    actorId: z.string().uuid().optional(),
    plan: planSchema.optional(),
  }).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unixTimestampToIso(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? new Date(value * 1_000).toISOString()
    : undefined;
}

function normalizedSubscriptionStatus(status: string): string {
  return ['canceled', 'incomplete_expired', 'unpaid'].includes(status) ? 'inactive' : status;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
