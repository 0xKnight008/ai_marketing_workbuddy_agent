import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ZernioAccount { externalId: string; displayName: string; capabilities: string[]; }
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
}
