import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';

import type { ActorContext } from '../contracts/domain';
import type { Database, TenantTransaction } from '../foundation/database';
import { encryptSecret } from '../foundation/secrets';
import { HttpError } from '../http/errors';
import { ImportService } from './service';

const actor: ActorContext = { actorId: 'user-1', workspaceId: 'workspace-1', role: 'owner' };

const sheetsKey = Buffer.alloc(32, 9).toString('base64');
const sheetsConfig = {
  GOOGLE_SHEETS_CLIENT_ID: 'client-id',
  GOOGLE_SHEETS_CLIENT_SECRET: 'client-secret',
  GOOGLE_SHEETS_OAUTH_REDIRECT_URI: 'https://gateway.example.com/api/imports/google/callback',
  SECRET_ENCRYPTION_KEY_BASE64: sheetsKey,
  AUTH_TOKEN_SECRET: 'test-only-auth-secret-padding-32',
};
const sheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';

function storedConnection(token = 'refresh-token') {
  const encrypted = encryptSecret(token, sheetsKey);
  return { ciphertext: encrypted.ciphertext, iv: encrypted.iv, authTag: encrypted.authTag };
}

function sheetsFetch(values: string[][], refreshStatus = 200): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return refreshStatus === 200
        ? new Response(JSON.stringify({ access_token: 'access-token' }))
        : new Response(JSON.stringify({ error: 'invalid_grant' }), { status: refreshStatus });
    }
    return new Response(JSON.stringify({ values }));
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

test('Discord billing and role gates precede network and provider failures never enqueue jobs', async () => {
  const owner = { ...actor, workspaceId: '11111111-1111-4111-8111-111111111111' };
  const channelId = '123456789012345678';
  const config = { DISCORD_IMPORT_BOT_TOKEN: 'test-only', DISCORD_IMPORT_CHANNELS: JSON.stringify({ [owner.workspaceId]: [channelId] }) };
  const input = { label: 'Discord', sourceType: 'discord', channelId };
  for (const options of [{ subscriptionStatus: 'inactive' }, { subscriptionStatus: 'active', creditsExhausted: true }]) {
    const { database, statements } = mockDatabase(options);
    const service = new ImportService(database, config, async () => assert.fail('must not fetch'));
    await assert.rejects(service.createImport(owner, input), error => error instanceof HttpError && error.statusCode === 402);
    assert.equal(statements.some(sql => sql.startsWith('INSERT')), false);
    await assert.rejects(service.createImport({ ...owner, role: 'viewer' }, input), /Forbidden/);
  }
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active' });
  await assert.rejects(new ImportService(database, config, async () => new Response('', { status: 429 })).createImport(owner, input), /rate_limited/);
  assert.equal(statements.some(sql => sql.startsWith('INSERT INTO job') || sql.startsWith('INSERT INTO import_')), false);
});

test('invalid import fields and UTF-8 byte overflow are rejected before database access', async () => {
  const database = { withWorkspace: () => assert.fail('validation must precede storage and billing') } as unknown as Database;
  const service = new ImportService(database);
  for (const [sourceType, content, code] of [
    ['csv', `text\n${'x'.repeat(2001)}`, 'import_item_1_text_exceeds_2000_characters'],
    ['paste', 'x'.repeat(2001), 'import_item_1_text_exceeds_2000_characters'],
    ['csv', `text,author\nhello,${'a'.repeat(121)}`, 'import_item_1_author_exceeds_120_characters'],
    ['paste', '中'.repeat(700000), 'import_content_exceeds_2_mib'],
  ]) {
    await assert.rejects(service.createImport(actor, { label: 'Validation', sourceType, content }), (error) => error instanceof HttpError && error.code === code);
  }
});

interface MockOptions {
  subscriptionStatus?: string; trialEndsAt?: string | null; creditsExhausted?: boolean;
  googleConnection?: { ciphertext: string; iv: string; authTag: string } | null;
  existingExternalIds?: string[];
  dedupAll?: boolean;
}

function mockDatabase(options: MockOptions = {}) {
  const statements: string[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.includes('FROM workspace_billing')) {
        if (options.subscriptionStatus === undefined) return { rows: [] as Row[], rowCount: 0 };
        return { rows: [{ status: options.subscriptionStatus, trialEndsAt: options.trialEndsAt ?? null }] as unknown as Row[], rowCount: 1 };
      }
      // usageSnapshot（迭代 5 额度门禁）的四条查询。
      if (sql.includes('RETURNING plan')) {
        return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: options.subscriptionStatus ?? 'active', trialEndsAt: options.trialEndsAt ?? null, paymentGraceEndsAt: null }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('AS "taskUsed"')) {
        return { rows: [{ taskUsed: 0, aiCreditsUsed: options.creditsExhausted ? 400 : 0, supplierSpendMicros: 0 }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('connectedAccounts')) return { rows: [{ connectedAccounts: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('AS "trialCreditsUsed"')) return { rows: [{ trialCreditsUsed: 0 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('FROM google_sheets_connection')) {
        if (sql.includes('google_email')) {
          return { rows: [{ email: 'owner@example.com', connectedAt: new Date().toISOString() }] as unknown as Row[], rowCount: 1 };
        }
        return options.googleConnection
          ? { rows: [options.googleConnection] as unknown as Row[], rowCount: 1 }
          : { rows: [] as Row[], rowCount: 0 };
      }
      if (sql.includes('FROM import_item') && sql.includes('external_id')) {
        const requested = (values?.[0] as string[] | undefined) ?? [];
        const ids = options.dedupAll ? requested : (options.existingExternalIds ?? []);
        const rows = ids.map((externalId) => ({ externalId }));
        return { rows: rows as unknown as Row[], rowCount: rows.length };
      }
      if (sql.startsWith('INSERT INTO import_batch')) {
        return { rows: [{ id: 'batch-1', createdAt: new Date().toISOString() }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('FROM import_batch')) {
        return { rows: [{ id: 'batch-1', label: 'L', sourceType: 'paste', status: 'pending', modelBand: 'eco', itemCount: 2, createdAt: new Date().toISOString(), classifiedAt: null }] as unknown as Row[], rowCount: 1 };
      }
      return { rows: [] as unknown as Row[], rowCount: 1 };
    },
  } as TenantTransaction;
  const database = {
    withWorkspace: async <T>(_workspaceId: string, operation: (inner: TenantTransaction) => Promise<T>) => operation(tx),
  } as Database;
  return { database, statements };
}

test('createImport rejects unpaid workspaces with 402 before inserting anything', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'inactive' });
  const service = new ImportService(database);
  await assert.rejects(
    () => service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: 'hello' }),
    (error) => error instanceof HttpError && error.statusCode === 402 && error.message === 'subscription_required',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO import_batch')), false);
});

test('createImport accepts trialing workspaces and enqueues classification', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 86_400_000).toISOString() });
  const service = new ImportService(database);
  const view = await service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: 'one\ntwo' });
  assert.equal(view.id, 'batch-1');
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO job") && sql.includes('import.classify')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO import_item')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO audit_event')));
});

test('createImport treats an unexpired trial window as paid', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'inactive', trialEndsAt: new Date(Date.now() + 60_000).toISOString() });
  const service = new ImportService(database);
  const view = await service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: 'one' });
  assert.equal(view.id, 'batch-1');
});

test('createImport rejects empty parses and oversized batches with 422', async () => {
  const { database } = mockDatabase({ subscriptionStatus: 'active' });
  const service = new ImportService(database);
  await assert.rejects(
    () => service.createImport(actor, { label: 'Batch', sourceType: 'csv', content: 'text\n\n\n' }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'import_no_items',
  );
  const huge = Array.from({ length: 5_001 }, (_, index) => `line ${index}`).join('\n');
  await assert.rejects(
    () => service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: huge }),
    (error) => error instanceof HttpError && error.statusCode === 422 && error.message === 'import_too_large',
  );
});

test('createImport rejects with ai_credits_exhausted when the balance is empty', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', creditsExhausted: true });
  const service = new ImportService(database);
  await assert.rejects(
    () => service.createImport(actor, { label: 'Batch', sourceType: 'paste', content: 'one\ntwo' }),
    (error) => error instanceof HttpError && error.statusCode === 402 && error.message === 'ai_credits_exhausted',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO import_batch')), false);
});

test('Google Sheets import requires provider configuration before any database access', async () => {
  const database = { withWorkspace: () => assert.fail('configuration gate must precede storage') } as unknown as Database;
  const service = new ImportService(database, {});
  await assert.rejects(
    service.createImport(actor, { label: 'Sheets', sourceType: 'google_sheets', spreadsheetId: sheetId }),
    (error) => error instanceof HttpError && error.statusCode === 503 && error.code === 'google_sheets_not_configured',
  );
});

test('Google Sheets import requires a stored connection and never touches the network without one', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', googleConnection: null });
  const service = new ImportService(database, sheetsConfig, async () => assert.fail('must not fetch'));
  await assert.rejects(
    service.createImport(actor, { label: 'Sheets', sourceType: 'google_sheets', spreadsheetId: sheetId }),
    (error) => error instanceof HttpError && error.statusCode === 409 && error.code === 'google_sheets_not_connected',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT')), false);
});

test('Google Sheets import maps a revoked grant to 409 and enqueues nothing', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', googleConnection: storedConnection() });
  const { fetcher } = sheetsFetch([['text'], ['hello']], 400);
  const service = new ImportService(database, sheetsConfig, fetcher);
  await assert.rejects(
    service.createImport(actor, { label: 'Sheets', sourceType: 'google_sheets', spreadsheetId: sheetId }),
    (error) => error instanceof HttpError && error.statusCode === 409 && error.code === 'google_sheets_connection_revoked',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO job') || sql.startsWith('INSERT INTO import_')), false);
});

test('Google Sheets import refreshes the token, maps rows and enqueues classification', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', googleConnection: storedConnection() });
  const { fetcher, calls } = sheetsFetch([
    ['text', 'author', 'platform'],
    ['Where can I buy this?', 'amy', 'x'],
    ['Please restock the serum', 'ben', 'rednote'],
  ]);
  const service = new ImportService(database, sheetsConfig, fetcher);
  const view = await service.createImport(actor, { label: 'Sheets', sourceType: 'google_sheets', spreadsheetId: sheetId, sheetName: 'Reviews' });
  assert.equal(view.id, 'batch-1');
  assert.equal(calls.length, 2);
  assert.ok(calls[0]!.startsWith('https://oauth2.googleapis.com/token'));
  assert.ok(calls[1]!.includes('/v4/spreadsheets/'));
  assert.ok(calls[1]!.includes(encodeURIComponent("'Reviews'!A1:AN5001")));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO job') && sql.includes('import.classify')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO import_item')));
  assert.ok(statements.some((sql) => sql.includes('pg_advisory_xact_lock')));
});

test('Google Sheets re-import drops rows the dedup lookup reports as stored', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', googleConnection: storedConnection(), dedupAll: true });
  const { fetcher } = sheetsFetch([['text'], ['Where can I buy this?']]);
  const service = new ImportService(database, sheetsConfig, fetcher);
  await assert.rejects(
    service.createImport(actor, { label: 'Second', sourceType: 'google_sheets', spreadsheetId: sheetId }),
    (error) => error instanceof HttpError && error.statusCode === 409 && error.code === 'google_sheets_no_new_rows',
  );
  assert.equal(statements.some((sql) => sql.startsWith('INSERT INTO job') || sql.startsWith('INSERT INTO import_')), false);
});

test('Google Sheets OAuth round-trip stores an encrypted token and audits the connection', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active' });
  const fetcher = (async () => new Response(JSON.stringify({
    access_token: 'a', refresh_token: 'r', scope: 'openid email sheets',
    id_token: `h.${Buffer.from(JSON.stringify({ email: 'owner@example.com' })).toString('base64url')}.s`,
  }))) as unknown as typeof fetch;
  const service = new ImportService(database, sheetsConfig, fetcher);
  const { url } = await service.startGoogleSheetsConnection(actor);
  const state = new URL(url).searchParams.get('state')!;
  const result = await service.completeGoogleSheetsOAuth({ code: 'code-1', state });
  assert.equal(result.email, 'owner@example.com');
  const insert = statements.find((sql) => sql.includes('INSERT INTO google_sheets_connection'));
  assert.ok(insert);
  assert.ok(!insert!.includes('refresh-token'));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO audit_event')));
  await assert.rejects(
    service.completeGoogleSheetsOAuth({ code: 'code-1', state: `${state}x` }),
    (error) => error instanceof HttpError && error.code === 'google_oauth_state_invalid',
  );
});

test('Google Sheets connection status reads the stored account and disconnect deletes it', async () => {
  const { database, statements } = mockDatabase({ subscriptionStatus: 'active', googleConnection: storedConnection() });
  const service = new ImportService(database, sheetsConfig, async () => new Response(''));
  const status = await service.googleSheetsConnection(actor);
  assert.equal(status.connected, true);
  assert.equal(status.email, 'owner@example.com');
  const after = await service.disconnectGoogleSheets(actor);
  assert.equal(after.connected, false);
  assert.ok(statements.some((sql) => sql.startsWith('DELETE FROM google_sheets_connection')));
  assert.ok(statements.filter((sql) => sql.includes('INSERT INTO audit_event')).length >= 1);
  await assert.rejects(
    service.disconnectGoogleSheets({ ...actor, role: 'viewer' }),
    /Forbidden/,
  );
});
