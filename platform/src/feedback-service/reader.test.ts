import test from "node:test";
import assert from "node:assert/strict";
import {
  collectFeedback,
  type FeedbackAccount,
  type InboxReader,
} from "./reader";
import { nextDailyTime } from "./service";
const account: FeedbackAccount = {
  id: "local",
  externalId: "remote",
  profileId: "profile",
  platform: "youtube",
  displayName: "Channel",
  status: "connected",
};
const since = "2026-11-01T00:00:00Z",
  until = "2026-11-02T00:00:00Z";
const comment = (id: string) => ({
  id,
  message: "Evidence " + id,
  createdTime: "2026-11-01T12:00:00Z",
  from: { name: "Reader" },
});
test("collection preserves overflow, follows cursors, excludes old comments and never writes upstream", async () => {
  const paths: string[] = [];
  const reader: InboxReader = {
    async readInboxPage(path) {
      paths.push(path);
      const u = new URL(path, "https://fixture.invalid");
      if (!u.pathname.endsWith("/post"))
        return {
          posts: [{ id: "post", accountId: "remote" }],
          pagination: { hasMore: false },
        };
      return u.searchParams.get("cursor")
        ? { comments: [comment("3")], pagination: { hasMore: false } }
        : {
            comments: [
              { ...comment("old"), createdTime: "2026-10-01" },
              comment("1"),
              comment("2"),
            ],
            pagination: { hasMore: true, cursor: "next" },
          };
    },
  };
  const a = await collectFeedback(
    reader,
    "workspace",
    account,
    since,
    until,
    1,
  );
  assert.deepEqual(
    a.items.map((i) => i.id),
    ["1"],
  );
  assert.equal(a.complete, false);
  assert.ok(a.checkpoint);
  const b = await collectFeedback(
    reader,
    "workspace",
    account,
    since,
    until,
    10,
    a.checkpoint,
  );
  assert.deepEqual(
    b.items.map((i) => i.id),
    ["2", "3"],
  );
  assert.equal(b.complete, true);
  assert.equal(paths.length, 3);
  assert.equal(paths[0], "/v1/accounts/remote/posts");
  for (const p of paths.slice(1))
    assert.equal(
      new URL(p, "https://fixture.invalid").searchParams.get("accountId"),
      "remote",
    );
});
test("foreign accounts fail closed; provider errors retain resumable progress", async () => {
  const wrong = await collectFeedback(
    {
      readInboxPage: async () => ({
        posts: [{ id: "p", accountId: "foreign" }],
      }),
    },
    "w",
    account,
    since,
    until,
    10,
  );
  assert.equal(wrong.error, "feedback_provider_account_mismatch");
  assert.equal(wrong.items.length, 0);
  let calls = 0;
  const fail = await collectFeedback(
    {
      readInboxPage: async () => {
        if (++calls === 1) return { posts: [{ id: "p", accountId: "remote" }] };
        throw new Error("secret provider details");
      },
    },
    "w",
    account,
    since,
    until,
    10,
  );
  assert.equal(fail.error, "feedback_source_unavailable");
  assert.ok(fail.checkpoint);
  assert.equal(fail.complete, false);
});
test("daily scheduling respects timezone and skips a nonexistent DST clock time", () => {
  assert.equal(
    nextDailyTime(
      "09:00",
      "Asia/Shanghai",
      new Date("2026-11-05T00:00Z"),
    ).toISOString(),
    "2026-11-05T01:00:00.000Z",
  );
  assert.equal(
    nextDailyTime(
      "02:30",
      "America/New_York",
      new Date("2026-03-08T05:00Z"),
    ).toISOString(),
    "2026-03-09T06:30:00.000Z",
  );
});

test('all comment platforms discover native IDs, preserve evidence and forward Reddit context', async () => {
  for (const platform of ['facebook','instagram','bluesky','threads','youtube','linkedin','tiktok','reddit']) {
    const nativeId = platform === 'linkedin' ? 'urn:li:ugcPost:123' : platform === 'bluesky' ? 'at://did:plc:abc/app.bsky.feed.post/xyz' : 'video-or-post';
    const paths:string[]=[];
    const result=await collectFeedback({readInboxPage:async path=>{
      paths.push(path);
      if(path.endsWith('/posts'))return {posts:[{id:nativeId,platform,createdTime:'2020-01-01',permalink:'https://social.example/post',subreddit:platform==='reddit'?'test':undefined}]};
      const url=new URL(path,'https://fixture.invalid');
      assert.equal(decodeURIComponent(url.pathname.split('/').pop()!),nativeId);
      assert.equal(url.searchParams.get('accountId'),'remote');
      if(platform==='reddit')assert.equal(url.searchParams.get('subreddit'),'test');
      return {comments:[comment('new')],meta:{accountId:'remote',platform}};
    }},'w',{...account,platform},since,until,10);
    assert.equal(result.error,null,platform);assert.equal(result.complete,true);assert.equal(result.items[0]?.postId,nativeId);assert.equal(result.items[0]?.url,'https://social.example/post');assert.equal(paths.length,2);assert.equal(result.postsWindowDays,0);
  }
});
test('X retains Inbox discovery and distinguishes per-account failures from unrelated skips',async()=>{
  for(const [meta,error] of [
    [{accountsSkipped:[{accountId:'foreign'}]},null],
    [{accountsSkipped:[{accountId:'remote'}]},'feedback_x_inbox_disabled'],
    [{accountsFailed:1,failedAccounts:[{accountId:'remote',code:'TOKEN_EXPIRED',error:'private'}]},'feedback_reconnect_required'],
    [{accountsFailed:1},'feedback_source_unavailable'],
  ] as const){
    const result=await collectFeedback({readInboxPage:async path=>{assert.ok(path.startsWith('/v1/inbox/comments?'));return {data:[],meta};}},'w',{...account,platform:'twitter'},since,until,10);
    assert.equal(result.error,error);assert.equal(result.complete,error===null);
  }
});
test('TikTok Business restriction and mismatched comment metadata are not successful empty scans',async()=>{
  for(const [body,error] of [[null,'feedback_tiktok_business_required'],[{comments:[],meta:{accountId:'foreign'}},'feedback_provider_account_mismatch']] as const){
    const result=await collectFeedback({readInboxPage:async path=>{if(path.endsWith('/posts'))return {posts:[{id:'p'}]};if(!body)throw new Error('feedback_platform_limitation');return body;}},'w',{...account,platform:'tiktok'},since,until,10);
    assert.equal(result.error,error);assert.equal(result.complete,false);
  }
});
test('legacy checkpoints retain Inbox pagination after upgrade',async()=>{
  const paths:string[]=[];
  const result=await collectFeedback({readInboxPage:async path=>{paths.push(path);return {data:[]};}},'w',account,since,until,10,{since,until,postSince:since,postIndex:0,postCursor:'old-opaque'});
  assert.equal(result.complete,true);assert.ok(paths[0]?.includes('/inbox/comments?'));assert.ok(paths[0]?.includes('cursor=old-opaque'));
});
