import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ZernioAccount { externalId: string; displayName: string; capabilities: string[]; }
export interface ZernioToken { accessToken: string; refreshToken?: string; expiresIn?: number; }
export interface ZernioClientOptions {
  baseUrl: string;
  oauthClientId: string;
  oauthRedirectUri: string;
  oauthStateSecret: string;
  /** Shared Zernio capacity reserved by this process (recommend 80% of plan RPM). */
  globalRequestsPerMinute?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export const DEFAULT_ZERNIO_CLIENT_RPM = 480;
const WORKSPACE_IN_FLIGHT_LIMIT = 10;

export class SupplierUnavailableError extends Error {
  constructor(message = 'Zernio is temporarily unavailable') {
    super(message);
    this.name = 'SupplierUnavailableError';
  }
}

export class SupplierBillingError extends Error {
  constructor(message = 'Zernio account capacity requires attention') {
    super(message);
    this.name = 'SupplierBillingError';
  }
}

function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return 250;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : Math.max(0, new Date(header).getTime() - Date.now()) || 250;
}

function canonicalStep(value: string): ZernioSelectionStep | undefined {
  const normalized = value.toLowerCase().replace(/[-_]/g, '');
  return ({
    selectpage: 'select_page',
    selectorganization: 'select_organization',
    selectboard: 'select_board',
    selectlocation: 'select_location',
    selectpublicprofile: 'select_public_profile',
    selectprofile: 'select_public_profile',
    selectaccount: 'select_account',
    selectphonenumber: 'select_phone_number',
  } as Record<string, ZernioSelectionStep>)[normalized];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export class ZernioClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly globalRequestsPerMinute: number;
  private readonly requestTimes: number[] = [];
  private readonly inFlight = new Map<string, number>();
  private circuitOpenUntil = 0;
  private consecutiveFailures = 0;

  constructor(private readonly options: ZernioClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.globalRequestsPerMinute = options.globalRequestsPerMinute ?? DEFAULT_ZERNIO_CLIENT_RPM;
  }

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
    if (this.requestTimes.length >= this.globalRequestsPerMinute) {
      if (workspaceId) this.inFlight.set(workspaceId, (this.inFlight.get(workspaceId) ?? 1) - 1);
      throw new SupplierUnavailableError('Zernio shared request capacity is temporarily full');
    }
    this.requestTimes.push(current);
    return () => {
      if (workspaceId) this.inFlight.set(workspaceId, Math.max(0, (this.inFlight.get(workspaceId) ?? 1) - 1));
    };
  }

  private async request(path: string, init: RequestInit, retries = 0, workspaceId?: string): Promise<Response> {
    const release = await this.acquire(workspaceId);
    let lastError: unknown;
    try {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const response = await this.fetchImpl(this.url(path), {
            ...init,
            headers: { authorization: `Bearer ${this.options.apiKey}`, ...init.headers },
            signal: AbortSignal.timeout(10_000),
          });
          if (response.status === 402) {
            const body = await response.json().catch(() => ({})) as { error?: unknown };
            throw new SupplierBillingError(typeof body.error === 'string' ? body.error : undefined);
          }
          if (response.status !== 429 && response.status < 500) {
            this.consecutiveFailures = 0;
            return response;
          }
          lastError = new Error(`Zernio request failed: ${response.status}`);
          if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, response.status === 429 ? retryAfterMs(response) : 250 * 2 ** attempt));
        } catch (error) {
          if (error instanceof SupplierBillingError) throw error;
          lastError = error;
          if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        }
      }
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 3) this.circuitOpenUntil = this.now() + 30_000;
      throw new SupplierUnavailableError(lastError instanceof Error ? lastError.message : undefined);
    } finally {
      release();
    }
  }

  createState(workspaceId: string, profileId: string, platform: ZernioPlatform, expiresAt = Math.floor(Date.now() / 1000) + 600): string {
    const payload = Buffer.from(JSON.stringify({ workspaceId, profileId, platform, exp: expiresAt })).toString('base64url');
    return `${payload}.${signature(payload, this.options.oauthStateSecret)}`;
  }

  verifyState(state: string, now = Math.floor(Date.now() / 1000)): { workspaceId: string; profileId: string; platform: ZernioPlatform } {
    const [payload, signed] = state.split('.');
    if (!payload || !signed) throw new Error('Invalid OAuth state');
    const provided = Buffer.from(signed);
    const expected = Buffer.from(signature(payload, this.options.oauthStateSecret));
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new Error('Invalid OAuth state signature');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { workspaceId?: unknown; profileId?: unknown; platform?: unknown; exp?: unknown };
    if (typeof parsed.workspaceId !== 'string' || typeof parsed.profileId !== 'string' || !ZERNIO_PLATFORMS.includes(parsed.platform as ZernioPlatform) || typeof parsed.exp !== 'number' || parsed.exp <= now) {
      throw new Error('Expired or invalid OAuth state');
    }
    return { workspaceId: parsed.workspaceId, profileId: parsed.profileId, platform: parsed.platform as ZernioPlatform };
  }

  async createProfile(workspaceId: string): Promise<string> {
    const name = `piggybot:${workspaceId}`;
    const response = await this.request('/v1/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `piggybot-workspace:${workspaceId}` },
      body: JSON.stringify({ name, description: `Piggybot workspace ${workspaceId}` }),
    }, 1, workspaceId);
    const value = await response.json().catch(() => ({})) as { profile?: { _id?: unknown }; details?: { existingProfileId?: unknown } };
    const profileId = string(value.profile?._id) ?? string(value.details?.existingProfileId);
    if ((!response.ok && response.status !== 409) || !profileId) throw new Error(`Zernio profile provisioning failed: ${response.status}`);
    return profileId;
  }

  async connectUrl(workspaceId: string, profileId: string, platform: ZernioPlatform): Promise<string> {
    const state = this.createState(workspaceId, profileId, platform);
    const redirect = new URL(this.options.oauthRedirectUri);
    redirect.searchParams.set('state', state);
    const path = `/v1/connect/${platform}?${new URLSearchParams({ profileId, headless: 'true', redirect_url: redirect.toString() })}`;
    const response = await this.request(path, {}, 1, workspaceId);
    const value = await response.json().catch(() => ({})) as { authUrl?: unknown; url?: unknown };
    const authUrl = string(value.authUrl) ?? string(value.url);
    if (!response.ok || !authUrl) throw new Error(`Zernio connect initialization failed: ${response.status}`);
    return authUrl;
  }

  parseHeadlessCallback(query: Record<string, unknown>): Omit<ZernioSelectionContext, 'workspaceId' | 'expiresAt'> | undefined {
    const step = typeof query.step === 'string' ? canonicalStep(query.step) : undefined;
    if (!step) return undefined;
    const platform = query.platform;
    const profileId = string(query.profileId);
    if (!ZERNIO_PLATFORMS.includes(platform as ZernioPlatform) || !profileId) throw new Error('Invalid Zernio headless callback');
    let userProfile: Record<string, unknown> | undefined;
    if (typeof query.userProfile === 'string' && query.userProfile) {
      try { userProfile = object(JSON.parse(query.userProfile)); } catch { throw new Error('Invalid Zernio user profile'); }
    }
    return {
      platform: platform as ZernioPlatform,
      profileId,
      step,
      tempToken: string(query.tempToken),
      pendingDataToken: string(query.pendingDataToken),
      connectToken: string(query.connect_token) ?? string(query.connectToken),
      userProfile,
      refreshToken: string(query.refreshToken),
      expiresIn: typeof query.expiresIn === 'string' ? Number(query.expiresIn) : undefined,
    };
  }

  async listSelections(context: ZernioSelectionContext): Promise<{ context: ZernioSelectionContext; options: ZernioSelectionOption[] }> {
    let enriched = context;
    let value: Record<string, unknown>;
    if (context.pendingDataToken && ['select_organization', 'select_board', 'select_public_profile'].includes(context.step)) {
      const response = await this.request(`/v1/connect/pending-data?${new URLSearchParams({ token: context.pendingDataToken })}`, {}, 1, context.workspaceId);
      if (!response.ok) throw new Error(`Zernio pending selection lookup failed: ${response.status}`);
      value = object(await response.json());
      enriched = {
        ...context,
        tempToken: string(value.tempToken) ?? context.tempToken,
        userProfile: object(value.userProfile ?? context.userProfile),
        refreshToken: string(value.refreshToken) ?? context.refreshToken,
        expiresIn: typeof value.expiresIn === 'number' ? value.expiresIn : context.expiresIn,
      };
    } else {
      const spec = selectionSpec(context.step);
      const query: Record<string, string> = { profileId: context.profileId };
      if (context.tempToken) query.tempToken = context.tempToken;
      if (context.pendingDataToken && context.step === 'select_location') query.pendingDataToken = context.pendingDataToken;
      const response = await this.request(`${spec.listPath}?${new URLSearchParams(query)}`, {
        headers: context.connectToken ? { 'x-connect-token': context.connectToken } : {},
      }, 1, context.workspaceId);
      if (!response.ok) throw new Error(`Zernio selection lookup failed: ${response.status}`);
      value = object(await response.json());
    }
    const spec = selectionSpec(context.step);
    const entries = Array.isArray(value[spec.responseKey]) ? value[spec.responseKey] as unknown[] : [];
    const options = entries.map((entry) => normalizeSelection(object(entry))).filter((entry): entry is ZernioSelectionOption => Boolean(entry));
    if (context.step === 'select_organization' && enriched.userProfile) {
      options.unshift({ id: '__personal__', label: string(enriched.userProfile.name) ?? 'Personal profile', detail: 'LinkedIn personal profile', value: enriched.userProfile });
    }
    return { context: enriched, options };
  }

  async select(context: ZernioSelectionContext, option: ZernioSelectionOption): Promise<void> {
    if (context.expiresAt <= Math.floor(this.now() / 1000)) throw new Error('Zernio selection session expired');
    const spec = selectionSpec(context.step);
    const common = { profileId: context.profileId, redirect_url: this.options.oauthRedirectUri };
    let body: Record<string, unknown>;
    switch (context.step) {
      case 'select_page': body = { ...common, pageId: option.id, tempToken: context.tempToken, userProfile: context.userProfile }; break;
      case 'select_organization': body = option.id === '__personal__'
        ? { ...common, accountType: 'personal', tempToken: context.tempToken, userProfile: context.userProfile }
        : { ...common, accountType: 'organization', selectedOrganization: option.value, tempToken: context.tempToken, userProfile: context.userProfile }; break;
      case 'select_board': body = { ...common, boardId: option.id, boardName: option.label, tempToken: context.tempToken, userProfile: context.userProfile, refreshToken: context.refreshToken, expiresIn: context.expiresIn }; break;
      case 'select_location': body = { ...common, locationId: option.id, accountId: string(option.value.accountId), pendingDataToken: context.pendingDataToken }; break;
      case 'select_public_profile': body = { ...common, selectedPublicProfile: option.value, tempToken: context.tempToken, userProfile: context.userProfile, refreshToken: context.refreshToken, expiresIn: context.expiresIn }; break;
      case 'select_account': body = { ...common, pageId: option.id, tempToken: context.tempToken }; break;
      case 'select_phone_number': body = { ...common, phoneNumberId: option.id, wabaId: option.value.wabaId, tempToken: context.tempToken, userProfile: context.userProfile }; break;
    }
    const response = await this.request(spec.selectPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(context.connectToken ? { 'x-connect-token': context.connectToken } : {}) },
      body: JSON.stringify(body),
    }, 1, context.workspaceId);
    if (!response.ok) throw new Error(`Zernio selection failed: ${response.status}`);
  }

  async listAccounts(profileId: string, workspaceId?: string): Promise<ZernioAccount[]> {
    const response = await this.request(`/v1/accounts?${new URLSearchParams({ profileId })}`, {}, 2, workspaceId);
    if (!response.ok) throw new Error(`Zernio account sync failed: ${response.status}`);
    const value = await response.json() as { accounts?: Array<Record<string, unknown>> };
    return (value.accounts ?? []).flatMap((account) => {
      const externalId = string(account._id) ?? string(account.id) ?? string(account.accountId);
      const displayName = string(account.displayName) ?? string(account.name) ?? string(account.username);
      if (!externalId || !displayName) return [];
      return [{ externalId, displayName, capabilities: Array.isArray(account.capabilities) ? account.capabilities.filter((item): item is string => typeof item === 'string') : [], platform: string(account.platform) }];
    });
  }

  async executeAction(idempotencyKey: string, action: Record<string, unknown>, workspaceId?: string): Promise<Record<string, unknown>> {
    const response = await this.request('/v1/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(action),
    }, 2, workspaceId);
    if (!response.ok) throw new Error(`Zernio action failed: ${response.status}`);
    return await response.json() as Record<string, unknown>;
  }
}

function selectionSpec(step: ZernioSelectionStep): { listPath: string; selectPath: string; responseKey: string } {
  return ({
    select_page: { listPath: '/v1/connect/facebook/select-page', selectPath: '/v1/connect/facebook/select-page', responseKey: 'pages' },
    select_organization: { listPath: '/v1/connect/linkedin/organizations', selectPath: '/v1/connect/linkedin/select-organization', responseKey: 'organizations' },
    select_board: { listPath: '/v1/connect/pinterest/select-board', selectPath: '/v1/connect/pinterest/select-board', responseKey: 'boards' },
    select_location: { listPath: '/v1/connect/googlebusiness/locations', selectPath: '/v1/connect/googlebusiness/select-location', responseKey: 'locations' },
    select_public_profile: { listPath: '/v1/connect/snapchat/select-profile', selectPath: '/v1/connect/snapchat/select-profile', responseKey: 'publicProfiles' },
    select_account: { listPath: '/v1/connect/instagram/select-account', selectPath: '/v1/connect/instagram/select-account', responseKey: 'pages' },
    select_phone_number: { listPath: '/v1/connect/whatsapp/select-phone-number', selectPath: '/v1/connect/whatsapp/select-phone-number', responseKey: 'phoneNumbers' },
  })[step];
}

function normalizeSelection(value: Record<string, unknown>): ZernioSelectionOption | undefined {
  const id = string(value.id) ?? string(value._id);
  if (!id) return undefined;
  const label = string(value.name) ?? string(value.displayName) ?? string(value.display_name) ?? string(value.verified_name) ?? string(value.username) ?? id;
  const detail = string(value.address) ?? string(value.username) ?? string(value.display_phone_number) ?? string(value.website);
  return { id, label, detail, value };
}
