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
          data: [{ id: "post", accountId: "remote" }],
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
  for (const p of paths)
    assert.equal(
      new URL(p, "https://fixture.invalid").searchParams.get("accountId"),
      "remote",
    );
});
test("foreign accounts fail closed; provider errors retain resumable progress", async () => {
  const wrong = await collectFeedback(
    {
      readInboxPage: async () => ({
        data: [{ id: "p", accountId: "foreign" }],
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
        if (++calls === 1) return { data: [{ id: "p", accountId: "remote" }] };
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
