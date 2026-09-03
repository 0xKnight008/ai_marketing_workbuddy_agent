import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { StripeActivationEvent } from '../billing/stripe';
import { Database } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { HttpError } from '../http/errors';
import { issueAccessToken } from './token';

const ticketClaimsSchema = z.object({
  version: z.literal(1),
  stripeEventId: z.string().min(1),
  workspaceId: z.string().uuid(),
  actorId: z.string().uuid(),
});

type TicketClaims = z.infer<typeof ticketClaimsSchema>;
type CheckoutIdentity = Pick<StripeActivationEvent, 'eventId' | 'workspaceId' | 'actorId'>;

interface ActivationEmail {
  to: string;
  activationUrl: string;
}

type EmailSender = (message: ActivationEmail) => Promise<void>;

/** Delivers and consumes post-checkout identity tickets; billing stays owned by PlatformService. */
export class ActivationDeliveryService {
  constructor(
    private readonly config: GatewayConfig,
    private readonly database: Database,
    private readonly sendEmail: EmailSender = (message) => sendActivationEmail(config, message),
  ) {}

  async deliverCheckout(input: CheckoutIdentity): Promise<void> {
    const delivery = await this.database.withWorkspace(input.workspaceId, async (tx) => {
      const owner = await tx.query<{ email: string }>(
        `SELECT u.email::text AS email
           FROM workspace_membership m
           JOIN app_user u ON u.id = m.user_id
          WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.role = 'owner'`,
        [input.workspaceId, input.actorId],
      );
      const email = owner.rows[0]?.email;
      if (!email) throw new HttpError(409, 'checkout_owner_not_found');

      const existing = await tx.query<{ expiresAt: string; emailSentAt: string | null }>(
        `SELECT expires_at::text AS "expiresAt", email_sent_at::text AS "emailSentAt"
           FROM activation_ticket
          WHERE stripe_event_id = $1`,
        [input.eventId],
      );
      const expiresAt = existing.rows[0]?.expiresAt
        ?? new Date(Date.now() + this.config.ACTIVATION_TICKET_TTL_SECONDS * 1_000).toISOString();
      const token = issueActivationTicket({
        version: 1,
        stripeEventId: input.eventId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
      }, this.config.AUTH_TOKEN_SECRET);
      await tx.query(
        `INSERT INTO activation_ticket (workspace_id, user_id, stripe_event_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (stripe_event_id) DO NOTHING`,
        [input.workspaceId, input.actorId, input.eventId, activationTicketHash(token), expiresAt],
      );
      return {
        email,
        token,
        emailAlreadySent: existing.rows[0]?.emailSentAt !== null && existing.rows[0]?.emailSentAt !== undefined,
      };
    });

    if (delivery.emailAlreadySent) return;
    const publicSite = this.config.PUBLIC_SITE_URL.replace(/\/$/, '');
    await this.sendEmail({
      to: delivery.email,
      activationUrl: `${publicSite}/activate?ticket=${encodeURIComponent(delivery.token)}`,
    });
    await this.database.withWorkspace(input.workspaceId, async (tx) => {
      const marked = await tx.query(
        `UPDATE activation_ticket
            SET email_sent_at = now()
          WHERE stripe_event_id = $1 AND email_sent_at IS NULL`,
        [input.eventId],
      );
      if (marked.rowCount) {
        await tx.query(
          'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
          [input.workspaceId, input.actorId, 'identity.activation_email_sent', { stripeEventId: input.eventId }],
        );
      }
    });
  }

  async exchangeTicket(body: unknown): Promise<{ accessToken: string; expiresAt: string }> {
    const { ticket } = z.object({ ticket: z.string().min(20).max(4096) }).parse(body);
    const claims = verifyActivationTicket(ticket, this.config.AUTH_TOKEN_SECRET);
    const nowSeconds = Math.floor(Date.now() / 1_000);

    await this.database.withWorkspace(claims.workspaceId, async (tx) => {
      const ticketRow = await tx.query<{ id: string }>(
        `SELECT id
           FROM activation_ticket
          WHERE workspace_id = $1 AND user_id = $2 AND stripe_event_id = $3
            AND token_hash = $4 AND consumed_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [claims.workspaceId, claims.actorId, claims.stripeEventId, activationTicketHash(ticket)],
      );
      if (!ticketRow.rows[0]) throw new HttpError(401, 'activation_ticket_invalid');
      const membership = await tx.query<{ role: string }>(
        'SELECT role::text AS role FROM workspace_membership WHERE workspace_id = $1 AND user_id = $2',
        [claims.workspaceId, claims.actorId],
      );
      if (membership.rows[0]?.role !== 'owner') throw new HttpError(403, 'owner_required');
      await tx.query('UPDATE activation_ticket SET consumed_at = now() WHERE id = $1', [ticketRow.rows[0].id]);
      await tx.query(
        'INSERT INTO audit_event (workspace_id, actor_id, event_type, payload) VALUES ($1, $2, $3, $4)',
        [claims.workspaceId, claims.actorId, 'identity.activation_ticket_consumed', { stripeEventId: claims.stripeEventId }],
      );
    });

    const expiresAtSeconds = nowSeconds + this.config.ACTIVATION_SESSION_TTL_SECONDS;
    return {
      accessToken: issueAccessToken({
        actorId: claims.actorId,
        workspaceId: claims.workspaceId,
        role: 'owner',
        exp: expiresAtSeconds,
      }, this.config.AUTH_TOKEN_SECRET),
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    };
  }
}

export function issueActivationTicket(claims: TicketClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(ticketClaimsSchema.parse(claims))).toString('base64url');
  const signature = createHmac('sha256', secret).update(`piggybot-activation.${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyActivationTicket(ticket: string, secret: string): TicketClaims {
  const [payload, receivedSignature] = ticket.split('.');
  if (!payload || !receivedSignature) throw new HttpError(401, 'activation_ticket_invalid');
  const expectedSignature = createHmac('sha256', secret).update(`piggybot-activation.${payload}`).digest('base64url');
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new HttpError(401, 'activation_ticket_invalid');
  try {
    return ticketClaimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch {
    throw new HttpError(401, 'activation_ticket_invalid');
  }
}

export function activationTicketHash(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex');
}

async function sendActivationEmail(config: GatewayConfig, message: ActivationEmail): Promise<void> {
  if (!config.RESEND_API_KEY || !config.RESEND_FROM_EMAIL) throw new HttpError(503, 'activation_email_not_configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: config.RESEND_FROM_EMAIL,
      to: [message.to],
      subject: 'Activate your Piggybot workspace',
      text: `Your Piggybot workspace is ready. This one-time link expires soon:\n\n${message.activationUrl}\n\nIf you did not make this purchase, ignore this email.`,
      html: `<p>Your Piggybot workspace is ready.</p><p><a href="${escapeHtml(message.activationUrl)}">Activate your workspace</a></p><p>This one-time link expires soon. If you did not make this purchase, ignore this email.</p>`,
    }),
  });
  if (!response.ok) throw new HttpError(502, 'activation_email_failed');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
