import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { GatewayConfig } from '../foundation/platform-config';
import { HttpError } from '../http/errors';
import { PLAN_KEYS, type PlanKey } from './plans';

const planSchema = z.enum(PLAN_KEYS);

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
  priceId?: string;
  workspaceId?: string;
}

function stripeConfiguration(config: GatewayConfig, plan: PlanKey) {
  const priceIds: Record<PlanKey, string | undefined> = {
    creator: config.STRIPE_PRICE_CREATOR,
    growth: config.STRIPE_PRICE_GROWTH,
    agency: config.STRIPE_PRICE_AGENCY,
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

export async function createStripeCheckoutSession(config: GatewayConfig, input: { workspaceId: string; actorId: string; plan: PlanKey; referralCode?: string }): Promise<StripeCheckoutSession> {
  const stripe = stripeConfiguration(config, input.plan);
  const body = new URLSearchParams();
  body.set('mode', 'subscription');
  body.set('line_items[0][price]', stripe.priceId);
  body.set('line_items[0][quantity]', '1');
  body.set('client_reference_id', input.workspaceId);
  body.set('metadata[workspaceId]', input.workspaceId);
  body.set('metadata[actorId]', input.actorId);
  body.set('metadata[plan]', input.plan);
  if (input.referralCode) body.set('metadata[referral_code]', input.referralCode);
  body.set('subscription_data[metadata][workspaceId]', input.workspaceId);
  body.set('subscription_data[metadata][plan]', input.plan);
  body.set('subscription_data[trial_period_days]', String(config.STRIPE_TRIAL_DAYS));
  body.set('success_url', `${config.PUBLIC_SITE_URL.replace(/\/$/, '')}/activate?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', `${config.PUBLIC_SITE_URL.replace(/\/$/, '')}/activate?checkout=cancelled`);

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
    priceId,
    workspaceId: workspaceMetadata(payload.metadata)?.workspaceId,
  };
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
