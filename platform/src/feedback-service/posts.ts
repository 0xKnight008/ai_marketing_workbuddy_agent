import type { FeedbackAccount, InboxReader } from './reader';

// GET /v1/accounts/{accountId}/posts: native IDs, at most 25 recent posts.
export const POST_PLATFORMS = [
  'facebook', 'instagram', 'twitter', 'bluesky', 'threads',
  'youtube', 'linkedin', 'tiktok', 'pinterest', 'reddit',
] as const;
export const supportsRecentPosts = (platform: string) =>
  (POST_PLATFORMS as readonly string[]).includes(platform);
export type RecentPost = {
  id: string;
  platform: string;
  text: string;
  url: string | null;
  publishedAt: string | null;
  subreddit?: string;
};

function publicPostUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function readRecentPosts(
  reader: InboxReader,
  workspaceId: string,
  account: FeedbackAccount,
): Promise<RecentPost[]> {
  if (!supportsRecentPosts(account.platform)) throw new Error('feedback_posts_unavailable');
  const page = await reader.readInboxPage(
    `/v1/accounts/${encodeURIComponent(account.externalId)}/posts`, workspaceId,
  );
  if (!Array.isArray(page.posts) || page.posts.length > 25)
    throw new Error('feedback_invalid_provider_response');
  return page.posts.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('feedback_invalid_provider_response');
    const p = raw as Record<string, unknown>;
    if ((p.accountId !== undefined && p.accountId !== account.externalId) ||
        (p.platform !== undefined && p.platform !== account.platform))
      throw new Error('feedback_provider_account_mismatch');
    if (typeof p.id !== 'string' || !p.id) throw new Error('feedback_invalid_provider_response');
    return {
      id: p.id,
      platform: account.platform,
      text: [p.message || p.title, p.description].filter(v => typeof v === 'string' && v).join('\n').slice(0, 12000),
      url: publicPostUrl(p.permalink),
      publishedAt: typeof p.createdTime === 'string' && Number.isFinite(Date.parse(p.createdTime))
        ? new Date(p.createdTime).toISOString() : null,
      ...(typeof p.subreddit === 'string' ? { subreddit: p.subreddit } : {}),
    };
  });
}
