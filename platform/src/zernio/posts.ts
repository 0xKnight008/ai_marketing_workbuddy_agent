/** Internal actions are not Zernio API bodies. Keep the translation explicit. */
export function postBody(action: Record<string, unknown>): Record<string, unknown> {
  if (!['social.create_post', 'social.schedule_post'].includes(String(action.type))) throw new Error('Unsupported Zernio action');
  if (typeof action.accountId !== 'string' || !action.accountId || typeof action.platform !== 'string' || !action.platform
    || typeof action.content !== 'string' || !action.content.trim()) throw new Error('Invalid Zernio publish target or content');
  const mode = action.mode ?? (action.type === 'social.schedule_post' ? 'schedule' : 'publish_now');
  if (!['schedule', 'publish_now'].includes(String(mode))) throw new Error('Invalid Zernio publish mode');
  if (mode === 'schedule' && (typeof action.scheduledAt !== 'string' || !Number.isFinite(Date.parse(action.scheduledAt)))) {
    throw new Error('Scheduled Zernio action requires scheduledAt');
  }
  if (action.hashtags !== undefined && (!Array.isArray(action.hashtags) || action.hashtags.some(tag => typeof tag !== 'string'))) {
    throw new Error('Invalid Zernio hashtags');
  }
  return {
    content: [action.content, ...(action.hashtags as string[] | undefined ?? [])].filter(Boolean).join(' '),
    platforms: [{ platform: providerPlatform(action.platform), accountId: action.accountId }],
    ...(mode === 'schedule' ? { scheduledFor: action.scheduledAt } : { publishNow: true }),
  };
}

export function providerPlatform(platform: string): string { return platform === 'x' ? 'twitter' : platform; }

export interface ZernioPostResult {
  postId: string;
  status: 'published' | 'pending' | 'failed';
  platform: string;
  accountId: string;
  platformPostUrl?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A 2xx/207 is not publication evidence. Check both the post and exact target. */
export function postResult(value: unknown, action: Record<string, unknown>, httpStatus = 200): ZernioPostResult {
  const body = record(value);
  const post = record(body.post);
  const postId = post._id ?? body.postId;
  if (typeof postId !== 'string' || !postId) throw new Error('Zernio response has no post ID');
  const platform = providerPlatform(String(action.platform));
  const accountId = String(action.accountId);
  // Accepted-but-not-yet-readable: persist the ID and GET it before success.
  if (httpStatus === 202 && !body.post) return { postId, platform, accountId, status: 'pending' };
  const targets = Array.isArray(post.platforms) ? post.platforms.map(record) : [];
  const target = targets.find(item => item.platform === platform
    && (typeof item.accountId === 'string' ? item.accountId : record(item.accountId)._id) === accountId);
  if (!target || targets.length !== 1) throw new Error('Zernio response target does not match requested account');
  const failed = httpStatus === 207 || ['failed', 'partial', 'partial_success', 'cancelled', 'canceled', 'draft'].includes(String(post.status))
    || ['failed', 'cancelled', 'canceled'].includes(String(target.status));
  const published = !failed && post.status === 'published' && target.status === 'published';
  const pending = ['scheduled', 'pending', 'publishing', 'queued', 'processing'].includes(String(post.status))
    && ['pending', 'scheduled', 'publishing', 'queued', 'processing'].includes(String(target.status));
  return { postId, platform, accountId, status: published ? 'published' : pending && !failed ? 'pending' : 'failed',
    ...(typeof target.platformPostUrl === 'string' ? { platformPostUrl: target.platformPostUrl } : {}) };
}
