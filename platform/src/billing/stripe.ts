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
  plan: PlanKey;
  customerId?: string;
  subscriptionId?: string;
  priceId?: string;
  subscriptionStatus: string;
  trialEndsAt?: string;
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

export async function createStripeCheckoutSession(config: GatewayConfig, input: { workspaceId: string; actorId: string; plan: PlanKey }): Promise<StripeCheckoutSession> {
  const stripe = stripeConfiguration(config, input.plan);
  const body = new URLSearchParams();
  body.set('mode', 'subscription');
  body.set('line_items[0][price]', stripe.priceId);
  body.set('line_items[0][quantity]', '1');
  body.set('client_reference_id', input.workspaceId);
  body.set('metadata[workspaceId]', input.workspaceId);
  body.set('metadata[actorId]', input.actorId);
  body.set('metadata[plan]', input.plan);
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

export function stripeActivationFromWebhook(rawBody: string, trialDays = 7): StripeActivationEvent | undefined {
  const event = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z.object({ object: z.record(z.unknown()) }),
  }).parse(JSON.parse(rawBody)) as StripeEvent;
  if (event.type !== 'checkout.session.completed') return undefined;
  const session = event.data.object;
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return undefined;
  const metadata = z.object({ workspaceId: z.string().uuid(), plan: planSchema }).parse(session.metadata ?? {});
  return {
    eventId: event.id,
    eventType: event.type,
    workspaceId: metadata.workspaceId,
    plan: metadata.plan,
    customerId: stringValue(session.customer),
    subscriptionId: stringValue(session.subscription),
    priceId: undefined,
    subscriptionStatus: 'trialing',
    trialEndsAt: new Date(Date.now() + trialDays * 86_400_000).toISOString(),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
