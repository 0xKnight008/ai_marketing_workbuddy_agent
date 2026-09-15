import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { HttpError } from '../http/errors';
import { csvRecordToItem, type ParsedItem } from './csv';

export const googleSpreadsheetId = z.string().regex(/^[A-Za-z0-9_-]{20,120}$/);
export const googleSheetName = z.string().trim().min(1).max(120);

const MAX_SHEET_ROWS = 5_000;
const MAX_SHEET_COLUMNS = 40;

export interface GoogleSheetsConfig {
  GOOGLE_SHEETS_CLIENT_ID?: string;
  GOOGLE_SHEETS_CLIENT_SECRET?: string;
  GOOGLE_SHEETS_OAUTH_REDIRECT_URI?: string;
  SECRET_ENCRYPTION_KEY_BASE64?: string;
}

export function assertGoogleSheetsConfigured(config: GoogleSheetsConfig): void {
  if (!config.GOOGLE_SHEETS_CLIENT_ID || !config.GOOGLE_SHEETS_CLIENT_SECRET || !config.GOOGLE_SHEETS_OAUTH_REDIRECT_URI) {
    throw new HttpError(503, 'google_sheets_not_configured');
  }
  // Refresh tokens are stored in the database; without the encryption key they
  // would have to be persisted in plaintext, which is never acceptable.
  if (!config.SECRET_ENCRYPTION_KEY_BASE64) throw new HttpError(503, 'google_sheets_encryption_not_configured');
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

/** OAuth state binds the callback to this workspace + actor for 10 minutes. */
export function createGoogleOAuthState(secret: string, workspaceId: string, actorId: string, expiresAt = Math.floor(Date.now() / 1000) + 600): string {
  const payload = Buffer.from(JSON.stringify({ workspaceId, actorId, exp: expiresAt })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyGoogleOAuthState(secret: string, state: string, now = Math.floor(Date.now() / 1000)): { workspaceId: string; actorId: string } {
  const [payload, signed] = state.split('.');
  if (!payload || !signed) throw new HttpError(400, 'google_oauth_state_invalid');
  const provided = Buffer.from(signed);
  const expected = Buffer.from(sign(payload, secret));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new HttpError(400, 'google_oauth_state_invalid');
  let parsed: { workspaceId?: unknown; actorId?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'google_oauth_state_invalid');
  }
  if (typeof parsed.workspaceId !== 'string' || typeof parsed.actorId !== 'string' || typeof parsed.exp !== 'number' || parsed.exp <= now) {
    throw new HttpError(400, 'google_oauth_state_expired');
  }
  return { workspaceId: parsed.workspaceId, actorId: parsed.actorId };
}

export function googleAuthorizeUrl(config: GoogleSheetsConfig, state: string): string {
  assertGoogleSheetsConfigured(config);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.GOOGLE_SHEETS_CLIENT_ID!);
  url.searchParams.set('redirect_uri', config.GOOGLE_SHEETS_OAUTH_REDIRECT_URI!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email https://www.googleapis.com/auth/spreadsheets.readonly');
  url.searchParams.set('access_type', 'offline');
  // Force the consent screen so Google always returns a refresh token.
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
  error: z.string().optional(),
}).strip();

export async function exchangeGoogleCode(config: GoogleSheetsConfig, code: string, fetcher: typeof fetch = fetch): Promise<{ refreshToken: string; email: string; scopes: string[] }> {
  const response = await tokenRequest(config, { code, grant_type: 'authorization_code', redirect_uri: config.GOOGLE_SHEETS_OAUTH_REDIRECT_URI! }, fetcher);
  if (response.status === 400 || response.status === 401) throw new HttpError(400, 'google_oauth_code_rejected');
  const parsed = await parseTokenResponse(response);
  if (!parsed.refresh_token) throw new HttpError(502, 'google_oauth_missing_refresh_token');
  const email = emailFromIdToken(parsed.id_token);
  if (!email) throw new HttpError(502, 'google_oauth_missing_email');
  return { refreshToken: parsed.refresh_token, email, scopes: (parsed.scope ?? '').split(' ').filter(Boolean) };
}

export async function refreshGoogleAccessToken(config: GoogleSheetsConfig, refreshToken: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await tokenRequest(config, { refresh_token: refreshToken, grant_type: 'refresh_token' }, fetcher);
  if (response.status === 400 || response.status === 401) throw new HttpError(409, 'google_sheets_connection_revoked');
  const parsed = await parseTokenResponse(response);
  return parsed.access_token;
}

async function tokenRequest(config: GoogleSheetsConfig, params: Record<string, string>, fetcher: typeof fetch): Promise<Response> {
  try {
    return await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.GOOGLE_SHEETS_CLIENT_ID!,
        client_secret: config.GOOGLE_SHEETS_CLIENT_SECRET!,
        ...params,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'google_oauth_provider_unavailable');
  }
}

async function parseTokenResponse(response: Response): Promise<z.infer<typeof tokenResponseSchema>> {
  const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) throw new HttpError(502, 'google_oauth_provider_unavailable');
  return parsed.data;
}

/** The id_token arrives directly from Google's token endpoint over TLS. */
function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown; email_verified?: unknown };
    return typeof claims.email === 'string' && claims.email.length <= 320 ? claims.email : undefined;
  } catch {
    return undefined;
  }
}

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const valuesResponseSchema = z.object({
  values: z.array(z.array(cellSchema).max(MAX_SHEET_COLUMNS + 1)).max(MAX_SHEET_ROWS + 1).optional(),
}).strip();

/** Bounded one-shot read of a single sheet range. Never follows redirects. */
export async function readGoogleSheetValues(accessToken: string, spreadsheetId: string, sheetName: string | undefined, fetcher: typeof fetch = fetch): Promise<string[][]> {
  const range = sheetName ? `'${sheetName.replace(/'/g, "''")}'!A1:AN${MAX_SHEET_ROWS + 1}` : `A1:AN${MAX_SHEET_ROWS + 1}`;
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  url.searchParams.set('majorDimension', 'ROWS');
  url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  let response: Response;
  try {
    response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'google_sheets_provider_unavailable');
  }
  if (response.status === 401) throw new HttpError(409, 'google_sheets_connection_revoked');
  if (response.status === 403 || response.status === 404) throw new HttpError(502, 'google_sheets_check_spreadsheet_sharing');
  if (response.status === 429) throw new HttpError(429, 'google_sheets_rate_limited_retry_later');
  if (!response.ok) throw new HttpError(502, 'google_sheets_provider_unavailable');
  const parsed = valuesResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new HttpError(502, 'google_sheets_invalid_response');
  return (parsed.data.values ?? []).map((row) => row.map((cell) => (cell === null ? '' : String(cell))));
}

/**
 * Header row → records → the shared CSV field mapping (text/comment/review/title,
 * metrics columns, platform aliases). Unnamed columns are ignored. Re-import
 * dedup keys on a content hash so row insertions or reordering inside the sheet
 * cannot create duplicates; edited rows are legitimately new feedback.
 */
export function sheetRowsToItems(rows: string[][], spreadsheetId: string): ParsedItem[] {
  const [header, ...data] = rows;
  if (!header || !data.length) return [];
  const keys = header.map((cell) => cell.trim().toLowerCase());
  const seen = new Set<string>();
  const items: ParsedItem[] = [];
  for (const row of data) {
    if (row.every((cell) => !cell.trim())) continue;
    const record: Record<string, string> = {};
    keys.forEach((key, index) => { if (key) record[key] = (row[index] ?? '').trim(); });
    const item = csvRecordToItem(record);
    if (!item) continue;
    const externalId = sheetRowExternalId(spreadsheetId, item.platform, item.text);
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    items.push({ ...item, externalId, metrics: { ...item.metrics, spreadsheetId } });
  }
  return items;
}

function sheetRowExternalId(spreadsheetId: string, platform: string, text: string): string {
  const digest = createHash('sha256').update(`${spreadsheetId}${platform}${text.replace(/\s+/g, ' ').trim()}`).digest('hex');
  return `gsheets:${digest.slice(0, 40)}`;
}
