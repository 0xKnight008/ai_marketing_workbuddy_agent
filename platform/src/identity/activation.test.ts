import assert from 'node:assert/strict';
import test from 'node:test';

import type { Database, TenantTransaction } from '../foundation/database';
import type { GatewayConfig } from '../foundation/platform-config';
import { verifyAccessToken } from './token';
import { activationTicketHash, ActivationDeliveryService, issueActivationTicket, verifyActivationTicket } from './activation';

const secret = 'test-activation-secret-must-be-at-least-32-bytes';
const claims = {
  version: 1 as const,
  stripeEventId: 'evt_checkout_1',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  actorId: '00000000-0000-4000-8000-000000000002',
};

test('activation tickets are signed, scoped, and stored only as hashes', () => {
  const ticket = issueActivationTicket(claims, secret);
  assert.deepEqual(verifyActivationTicket(ticket, secret), claims);
  assert.match(activationTicketHash(ticket), /^[a-f0-9]{64}$/);
  assert.throws(() => verifyActivationTicket(`${ticket}x`, secret), /activation_ticket_invalid/);
  assert.throws(() => verifyActivationTicket(ticket, `${secret}x`), /activation_ticket_invalid/);
});

test('a ticket exchanges once for a short-lived owner session', async () => {
  let consumed = false;
  const database = {
    async withWorkspace(workspaceId: string, operation: (tx: TenantTransaction) => Promise<unknown>) {
      assert.equal(workspaceId, claims.workspaceId);
      const tx = {
        async query(sql: string) {
          if (sql.includes('FROM activation_ticket')) return { rows: consumed ? [] : [{ id: 'ticket-1' }], rowCount: consumed ? 0 : 1 };
          if (sql.includes('FROM workspace_membership')) return { rows: [{ role: 'owner' }], rowCount: 1 };
          if (sql.includes('UPDATE activation_ticket')) consumed = true;
          return { rows: [], rowCount: 1 };
        },
      } as unknown as TenantTransaction;
      return operation(tx);
    },
  } as unknown as Database;
  const config = {
    AUTH_TOKEN_SECRET: secret,
    ACTIVATION_SESSION_TTL_SECONDS: 3_600,
  } as GatewayConfig;
  const ticket = issueActivationTicket(claims, secret);
  const service = new ActivationDeliveryService(config, database);

  const session = await service.exchangeTicket({ ticket });
  assert.deepEqual(verifyAccessToken(session.accessToken, secret), {
    actorId: claims.actorId,
    workspaceId: claims.workspaceId,
    role: 'owner',
    exp: Math.floor(new Date(session.expiresAt).getTime() / 1_000),
  });
  await assert.rejects(() => service.exchangeTicket({ ticket }), /activation_ticket_invalid/);
});

test('checkout delivery emails the owner and persists only the ticket hash', async () => {
  let insertedValues: readonly unknown[] | undefined;
  let deliveredUrl = '';
  const database = {
    async withWorkspace(workspaceId: string, operation: (tx: TenantTransaction) => Promise<unknown>) {
      assert.equal(workspaceId, claims.workspaceId);
      const tx = {
        async query(sql: string, values?: readonly unknown[]) {
          if (sql.includes('FROM workspace_membership')) return { rows: [{ email: 'owner@example.com' }], rowCount: 1 };
          if (sql.includes('FROM activation_ticket')) return { rows: [], rowCount: 0 };
          if (sql.includes('INSERT INTO activation_ticket')) insertedValues = values;
          return { rows: [], rowCount: sql.includes('UPDATE activation_ticket') ? 1 : 0 };
        },
      } as unknown as TenantTransaction;
      return operation(tx);
    },
  } as unknown as Database;
  const config = {
    AUTH_TOKEN_SECRET: secret,
    PUBLIC_SITE_URL: 'https://www.piggybot.me/',
    ACTIVATION_TICKET_TTL_SECONDS: 1_800,
  } as GatewayConfig;
  const service = new ActivationDeliveryService(config, database, async ({ to, activationUrl }) => {
    assert.equal(to, 'owner@example.com');
    deliveredUrl = activationUrl;
  });

  await service.deliverCheckout({
    eventId: claims.stripeEventId,
    workspaceId: claims.workspaceId,
    actorId: claims.actorId,
  });

  const ticket = new URL(deliveredUrl).searchParams.get('ticket');
  assert.ok(ticket);
  assert.deepEqual(verifyActivationTicket(ticket, secret), claims);
  assert.equal(insertedValues?.[3], activationTicketHash(ticket));
  assert.notEqual(insertedValues?.[3], ticket);
});
