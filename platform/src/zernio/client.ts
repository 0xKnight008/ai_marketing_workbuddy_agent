import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ZernioAccount { externalId: string; displayName: string; capabilities: string[]; }
export interface ZernioToken { accessToken: string; refreshToken?: string; expiresIn?: number; }
export interface ZernioClientOptions { baseUrl: string; oauthClientId: string; oauthRedirectUri: string; oauthStateSecret: string; fetchImpl?: typeof fetch; }

function signature(value: string, secret: string): string { return createHmac('sha256', secret).update(value).digest('base64url'); }

export class ZernioClient {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: ZernioClientOptions) { this.fetchImpl = options.fetchImpl ?? fetch; }

  connectUrl(workspaceId: string, expiresAt = Math.floor(Date.now() / 1000) + 600): string {
    const payload = Buffer.from(JSON.stringify({ workspaceId, exp: expiresAt })).toString('base64url');
    const state = `${payload}.${signature(payload, this.options.oauthStateSecret)}`;
    const url = new URL('/oauth/authorize', this.options.baseUrl);
    url.searchParams.set('client_id', this.options.oauthClientId);
    url.searchParams.set('redirect_uri', this.options.oauthRedirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  verifyState(state: string, now = Math.floor(Date.now() / 1000)): { workspaceId: string } {
    const [payload, signed] = state.split('.');
    if (!payload || !signed) throw new Error('Invalid OAuth state');
    const expected = signature(payload, this.options.oauthStateSecret);
    const provided = Buffer.from(signed);
    const expectedBuffer = Buffer.from(expected);
    if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) throw new Error('Invalid OAuth state signature');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { workspaceId?: string; exp?: number };
    if (!parsed.workspaceId || !parsed.exp || parsed.exp <= now) throw new Error('Expired OAuth state');
    return { workspaceId: parsed.workspaceId };
  }

  async exchangeCode(code: string): Promise<ZernioToken> {
    const response = await this.fetchImpl(new URL('/oauth/token', this.options.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, client_id: this.options.oauthClientId, redirect_uri: this.options.oauthRedirectUri, grant_type: 'authorization_code' }) });
    if (!response.ok) throw new Error(`Zernio token exchange failed: ${response.status}`);
    const value = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!value.access_token) throw new Error('Zernio token response omitted access_token');
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresIn: value.expires_in };
  }

  async listAccounts(accessToken: string): Promise<ZernioAccount[]> {
    const response = await this.fetchImpl(new URL('/v1/accounts', this.options.baseUrl), { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Zernio account sync failed: ${response.status}`);
    const value = await response.json() as { accounts?: Array<{ id?: string; name?: string; capabilities?: string[] }> };
    return (value.accounts ?? []).flatMap((account) => account.id && account.name ? [{ externalId: account.id, displayName: account.name, capabilities: account.capabilities ?? [] }] : []);
  }

  async executeAction(accessToken: string, idempotencyKey: string, action: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(new URL('/v1/actions', this.options.baseUrl), { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify(action) });
    if (!response.ok) throw new Error(`Zernio action failed: ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }
}
