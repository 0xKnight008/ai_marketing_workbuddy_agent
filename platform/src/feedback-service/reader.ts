import { readRecentPosts } from './posts';
import { feedbackProviderError } from './provider-errors';
/** Zernio Comments API: account-scoped, read-only, opaque cursor pagination.
 * New non-X scans read the latest 25 posts; X and legacy checkpoints use the 30-day Inbox feed.
 * Neither discovery method is a complete historical inbox.
 * https://github.com/zernio-dev/zernio-rust/blob/main/docs/CommentsApi.md
 */
export interface InboxReader {
  readInboxPage(
    path: string,
    workspaceId: string,
  ): Promise<Record<string, unknown>>;
}
export interface FeedbackAccount {
  id: string;
  externalId: string;
  profileId: string;
  platform: string;
  displayName: string;
  status: string;
}
export interface FeedbackItem {
  id: string;
  text: string;
  author: string | null;
  publishedAt: string;
  url: string | null;
  postId: string;
  likes: number;
}
export interface Checkpoint {
  since: string;
  until: string;
  postSince: string;
  postCursor?: string;
  posts?: Array<{ id: string; url: string | null; subreddit?: string }>;
  discovery?: "recent_posts" | "inbox";
  postIndex: number;
  commentCursor?: string;
  pending?: FeedbackItem[];
  postHasMore?: boolean;
}
export interface Collection {
  items: FeedbackItem[];
  checkpoint: Checkpoint | null;
  complete: boolean;
  error: string | null;
  postsWindowDays: number;
  missingDates: number;
}
export const READ_PLATFORMS = ["facebook", "instagram", "twitter", "bluesky", "threads", "youtube", "linkedin", "tiktok", "reddit"] as const;
export const supportedReadPlatform = (p: string) =>
  READ_PLATFORMS.includes(p as (typeof READ_PLATFORMS)[number]);
const str = (x: unknown) => (typeof x === "string" ? x : "");
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
const value = (o: Record<string, unknown>, a: string, b: string) =>
  o[a] ?? o[b];
const safeUrl = (v: unknown) => {
  try {
    const u = new URL(str(v));
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
};
export function commentItem(
  raw: unknown,
  post: { id: string; url: string | null },
): FeedbackItem | null {
  const c = obj(raw),
    id = str(c.id),
    text = str(c.message),
    date = str(value(c, "createdTime", "created_time"));
  if (!id || !text.trim() || !Number.isFinite(Date.parse(date))) return null;
  return {
    id,
    text: text.slice(0, 20000),
    author:
      (str(obj(c.from).name) || str(obj(c.from).username)).slice(0, 120) ||
      null,
    publishedAt: new Date(date).toISOString(),
    url: safeUrl(c.url) || post.url,
    postId: post.id,
    likes: Math.max(0, Number(value(c, "likeCount", "like_count")) || 0),
  };
}
export async function collectFeedback(
  reader: InboxReader,
  workspaceId: string,
  account: FeedbackAccount,
  since: string,
  until: string,
  limit: number,
  resume?: Checkpoint | null,
): Promise<Collection> {
  const state: Checkpoint = resume
    ? structuredClone(resume)
    : {
        since,
        until,
        postSince: new Date(Date.parse(until) - 30 * 86400000).toISOString(),
        postIndex: 0,
        discovery: account.platform === "twitter" ? "inbox" : "recent_posts",
      };
  const items: FeedbackItem[] = [];
  let requests = 0,
    missingDates = 0;
  const seen = new Set<string>();
  const add = (item: FeedbackItem) => {
    if (
      Date.parse(item.publishedAt) >= Date.parse(state.since) &&
      Date.parse(item.publishedAt) <= Date.parse(state.until) &&
      !seen.has(item.id)
    ) {
      items.push(item);
      seen.add(item.id);
    }
  };
  try {
    while (items.length < limit && requests < 25) {
      if (state.pending?.length) {
        while (state.pending.length && items.length < limit)
          add(state.pending.shift()!);
        if (items.length >= limit) break;
      }
      if (!state.posts && state.discovery === "recent_posts") {
        state.posts = await readRecentPosts(reader, workspaceId, account);
        requests++;
        state.postIndex = 0;
        state.postHasMore = false;
      }
      if (!state.posts) {
        const q = new URLSearchParams({
          profileId: account.profileId,
          accountId: account.externalId,
          platform: account.platform,
          since: state.postSince,
          sortBy: "date",
          sortOrder: "desc",
          limit: "50",
        });
        if (state.postCursor) q.set("cursor", state.postCursor);
        const page = await reader.readInboxPage(
          "/v1/inbox/comments?" + q,
          workspaceId,
        );
        requests++;
        if (!Array.isArray(page.data))
          throw new Error("feedback_invalid_provider_response");
        const skipped = obj(page.meta).accountsSkipped;
        const failed = obj(page.meta).failedAccounts;
        const failure = Array.isArray(failed) ? failed.map(obj).find(a => a.accountId === account.externalId) : undefined;
        if (Number(obj(page.meta).accountsFailed) > 0 && (!Array.isArray(failed) || !failed.length))
          throw new Error("feedback_source_unavailable");
        if (failure) throw new Error(feedbackProviderError(403, failure.code, account.platform));
        if (Array.isArray(skipped) && skipped.map(obj).some(a => a.accountId === account.externalId))
          throw new Error(account.platform === 'twitter' ? 'feedback_x_inbox_disabled' : 'feedback_platform_limitation');
        const posts = [];
        for (const raw of page.data) {
          const p = obj(raw);
          if (str(value(p, "accountId", "account_id")) !== account.externalId)
            throw new Error("feedback_provider_account_mismatch");
          if (p.isAd === true || p.is_ad === true) continue;
          if (!str(p.id)) throw new Error("feedback_invalid_provider_response");
          posts.push({ id: str(p.id), url: safeUrl(p.permalink) });
        }
        const pagination = obj(page.pagination);
        state.posts = posts;
        state.postIndex = 0;
        state.postHasMore =
          pagination.hasMore === true || pagination.has_more === true;
        const cursor = str(
          pagination.nextCursor ?? pagination.next_cursor ?? pagination.cursor,
        );
        if (state.postHasMore && (!cursor || cursor === state.postCursor))
          throw new Error("feedback_invalid_provider_cursor");
        state.postCursor = cursor || undefined;
      }
      if (state.postIndex >= state.posts.length) {
        if (!state.postHasMore)
          return {
            items,
            checkpoint: null,
            complete: true,
            error: null,
            postsWindowDays: state.discovery === "recent_posts" ? 0 : 30,
            missingDates,
          };
        state.posts = undefined;
        continue;
      }
      const post = state.posts[state.postIndex]!;
      const q = new URLSearchParams({
        accountId: account.externalId,
        limit: "100",
      });
      if (post.subreddit) q.set("subreddit", post.subreddit);
      if (state.commentCursor) q.set("cursor", state.commentCursor);
      const page = await reader.readInboxPage(
        "/v1/inbox/comments/" + encodeURIComponent(post.id) + "?" + q,
        workspaceId,
      );
      requests++;
      const meta = obj(page.meta);
      if ((meta.accountId !== undefined && meta.accountId !== account.externalId) || (meta.platform !== undefined && meta.platform !== account.platform))
        throw new Error("feedback_provider_account_mismatch");
      if (!Array.isArray(page.comments))
        throw new Error("feedback_invalid_provider_response");
      const normalized: FeedbackItem[] = [];
      for (const raw of page.comments) {
        const rows = [
          raw,
          ...(Array.isArray(obj(raw).replies)
            ? (obj(raw).replies as unknown[])
            : []),
        ];
        for (const row of rows) {
          const item = commentItem(row, post);
          if (item) normalized.push(item);
          else missingDates++;
        }
      }
      state.pending = normalized;
      const pagination = obj(page.pagination),
        more = pagination.hasMore === true || pagination.has_more === true;
      if (more) {
        const next = str(
          pagination.nextCursor ?? pagination.next_cursor ?? pagination.cursor,
        );
        if (!next || next === state.commentCursor)
          throw new Error("feedback_invalid_provider_cursor");
        state.commentCursor = next;
      } else {
        state.commentCursor = undefined;
        state.postIndex++;
      }
    }
    return {
      items,
      checkpoint: state,
      complete: false,
      error: null,
      postsWindowDays: state.discovery === "recent_posts" ? 0 : 30,
      missingDates,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return {
      items,
      checkpoint: state,
      complete: false,
      error: message === "feedback_platform_limitation" && account.platform === "tiktok" ? "feedback_tiktok_business_required" : /^feedback_[a-z_]+$/.test(message)
        ? message
        : "feedback_source_unavailable",
      postsWindowDays: state.discovery === "recent_posts" ? 0 : 30,
      missingDates,
    };
  }
}
