import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ZernioAccount { externalId: string; displayName: string; capabilities: string[]; }
export interface ZernioToken { accessToken: string; refreshToken?: string; expiresIn?: number; }
export interface ZernioClientOptions { baseUrl: string; oauthClientId: string; oauthRedirectUri: string; oauthStateSecret: string; fetchImpl?: typeof fetch; now?: () => number; }

const GLOBAL_REQUESTS_PER_MINUTE = 480;
const WORKSPACE_IN_FLIGHT_LIMIT = 10;

export class SupplierUnavailableError extends Error { constructor(message = 'Zernio is temporarily unavailable') { super(message); this.name = 'SupplierUnavailableError'; } }

function signature(value: string, secret: string): string { return createHmac('sha256', secret).update(value).digest('base64url'); }
function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return 250;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : Math.max(0, new Date(header).getTime() - Date.now()) || 250;
}

export class ZernioClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly requestTimes: number[] = [];
  private readonly inFlight = new Map<string, number>();
  private circuitOpenUntil = 0;
  private consecutiveFailures = 0;

  constructor(private readonly options: ZernioClientOptions) { this.fetchImpl = options.fetchImpl ?? fetch; this.now = options.now ?? Date.now; }

  private async acquire(workspaceId?: string): Promise<() => void> {
    const current = this.now();
    if (this.circuitOpenUntil > current) throw new SupplierUnavailableError();
    if (workspaceId) {
      const active = this.inFlight.get(workspaceId) ?? 0;
      if (active >= WORKSPACE_IN_FLIGHT_LIMIT) throw new SupplierUnavailableError('Workspace connector concurrency limit reached');
      this.inFlight.set(workspaceId, active + 1);
    }
    const windowStart = current - 60_000;
    while (this.requestTimes.length && (this.requestTimes[0] ?? current) <= windowStart) this.requestTimes.shift();
    if (this.requestTimes.length >= GLOBAL_REQUESTS_PER_MINUTE) {
      if (workspaceId) this.inFlight.set(workspaceId, (this.inFlight.get(workspaceId) ?? 1) - 1);
      throw new SupplierUnavailableError('Zernio shared request capacity is temporarily full');
    }
    this.requestTimes.push(current);
    return () => { if (workspaceId) this.inFlight.set(workspaceId, Math.max(0, (this.inFlight.get(workspaceId) ?? 1) - 1)); };
  }

  private async request(input: URL, init: RequestInit, retries = 0, workspaceId?: string): Promise<Response> {
    const release = await this.acquire(workspaceId);
    let lastError: unknown;
    try {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const response = await this.fetchImpl(input, { ...init, signal: AbortSignal.timeout(10_000) });
          if (response.status !== 429 && response.status < 500) { this.consecutiveFailures = 0; return response; }
          lastError = new Error(`Zernio request failed: ${response.status}`);
          if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, response.status === 429 ? retryAfterMs(response) : 250 * 2 ** attempt));
        } catch (error) { lastError = error; if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)); }
      }
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 3) this.circuitOpenUntil = this.now() + 30_000;
      throw new SupplierUnavailableError(lastError instanceof Error ? lastError.message : undefined);
    } finally { release(); }
  }

  connectUrl(workspaceId: string, expiresAt = Math.floor(Date.now() / 1000) + 600): string {
    const payload = Buffer.from(JSON.stringify({ workspaceId, exp: expiresAt })).toString('base64url');
    const state = `${payload}.${signature(payload, this.options.oauthStateSecret)}`;
    const url = new URL('/oauth/authorize', this.options.baseUrl);
    url.searchParams.set('client_id', this.options.oauthClientId); url.searchParams.set('redirect_uri', this.options.oauthRedirectUri); url.searchParams.set('state', state);
    return url.toString();
  }

  verifyState(state: string, now = Math.floor(Date.now() / 1000)): { workspaceId: string } {
    const [payload, signed] = state.split('.'); if (!payload || !signed) throw new Error('Invalid OAuth state');
    const expected = signature(payload, this.options.oauthStateSecret); const provided = Buffer.from(signed); const expectedBuffer = Buffer.from(expected);
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) throw new Error('Invalid OAuth state signature');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { workspaceId?: string; exp?: number };
    if (!parsed.workspaceId || !parsed.exp || parsed.exp <= now) throw new Error('Expired OAuth state'); return { workspaceId: parsed.workspaceId };
  }

  async exchangeCode(code: string): Promise<ZernioToken> {
    const response = await this.request(new URL('/oauth/token', this.options.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, client_id: this.options.oauthClientId, redirect_uri: this.options.oauthRedirectUri, grant_type: 'authorization_code' }) }, 1);
    if (!response.ok) throw new Error(`Zernio token exchange failed: ${response.status}`); const value = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!value.access_token) throw new Error('Zernio token response omitted access_token'); return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresIn: value.expires_in };
  }

  async listAccounts(accessToken: string, workspaceId?: string): Promise<ZernioAccount[]> {
    const response = await this.request(new URL('/v1/accounts', this.options.baseUrl), { headers: { authorization: `Bearer ${accessToken}` } }, 2, workspaceId);
    if (!response.ok) throw new Error(`Zernio account sync failed: ${response.status}`); const value = await response.json() as { accounts?: Array<{ id?: string; name?: string; capabilities?: string[] }> };
    return (value.accounts ?? []).flatMap((account) => account.id && account.name ? [{ externalId: account.id, displayName: account.name, capabilities: account.capabilities ?? [] }] : []);
  }

  async executeAction(accessToken: string, idempotencyKey: string, action: Record<string, unknown>, workspaceId?: string): Promise<Record<string, unknown>> {
    const response = await this.request(new URL('/v1/actions', this.options.baseUrl), { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify(action) }, 2, workspaceId);
    if (!response.ok) throw new Error(`Zernio action failed: ${response.status}`); return await response.json() as Record<string, unknown>;
  }
}
