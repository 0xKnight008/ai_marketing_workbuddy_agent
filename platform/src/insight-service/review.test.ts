import assert from "node:assert/strict";
import test from "node:test";
import type { Database, TenantTransaction } from "../foundation/database";
import type { ActorContext } from "../contracts/domain";
import { InsightFeedbackService } from "./feedback";
import { reportHighlights } from "../contracts/report-highlights";
const actor: ActorContext = {
  workspaceId: "workspace-1",
  actorId: "user-1",
  role: "owner",
};
const id = "11111111-1111-4111-8111-111111111111";
const report = {
  hotTopics: [
    {
      topic: "Onboarding",
      citations: [{ ref: "i1", snippet: "Where is the guide?" }],
    },
  ],
};
function fixture(found = true) {
  let review: unknown = null;
  const statements: string[] = [];
  const database = {
    withWorkspace: async <T>(
      workspace: string,
      fn: (tx: TenantTransaction) => Promise<T>,
    ) => {
      assert.equal(workspace, actor.workspaceId);
      return fn({
        query: async (sql: string, values: unknown[] = []) => {
          statements.push(sql);
          if (sql.includes("FROM insight_report")) {
            assert.match(
              sql,
              /workspace_id = current_setting\('app.workspace_id'\)::uuid/,
            );
            assert.match(sql, /status = 'generated'/);
            return {
              rows: found
                ? [{ template: "community_digest", report, review }]
                : [],
            };
          }
          if (sql.startsWith("UPDATE insight_report"))
            review = JSON.parse(String(values[1]));
          return { rows: [], rowCount: 1 };
        },
      } as unknown as TenantTransaction);
    },
  } as Database;
  return { service: new InsightFeedbackService(database), statements };
}
test("review persists, reopens and retries without new charges or duplicate audit entries", async () => {
  const { service, statements } = fixture();
  assert.equal((await service.review(actor, id)).review, null);
  const saved = await service.review(actor, id, {
    reviewed: true,
    selectedKeys: ["hotTopics:0", "hotTopics:0"],
  });
  assert.deepEqual(saved.review?.selectedKeys, ["hotTopics:0"]);
  assert.equal(saved.review?.actorId, actor.actorId);
  assert.deepEqual(await service.review(actor, id), saved);
  assert.deepEqual(
    await service.review(actor, id, {
      reviewed: true,
      selectedKeys: ["hotTopics:0"],
    }),
    saved,
  );
  assert.equal(statements.filter((s) => s.startsWith("UPDATE")).length, 1);
  assert.ok(statements.some((s) => s.endsWith("FOR UPDATE")));
  assert.ok(
    statements.every(
      (s) => !/job|ai_credit|approval_request|task_event/.test(s),
    ),
  );
  await service.review(actor, id, { reviewed: true, selectedKeys: [] });
  assert.deepEqual((await service.review(actor, id)).review?.selectedKeys, []);
});
test("read-only roles, inaccessible reports, spoofed keys and unreviewed writes are rejected", async () => {
  const { service, statements } = fixture();
  assert.equal(
    (await service.review({ ...actor, role: "viewer" }, id)).canEdit,
    false,
  );
  await assert.rejects(
    service.review({ ...actor, role: "viewer" }, id, {
      reviewed: true,
      selectedKeys: [],
    }),
    { statusCode: 403 },
  );
  await assert.rejects(fixture(false).service.review(actor, id), {
    statusCode: 404,
  });
  await assert.rejects(
    fixture(false).service.review(actor, id, {
      reviewed: true,
      selectedKeys: [],
    }),
    { statusCode: 404 },
  );
  await assert.rejects(
    service.review(actor, id, { reviewed: true, selectedKeys: ["forged:0"] }),
    { statusCode: 422 },
  );
  await assert.rejects(
    service.review(actor, id, { reviewed: false, selectedKeys: [] }),
  );
  await assert.rejects(
    service.review(actor, id, {
      reviewed: true,
      selectedKeys: [],
      actorId: "spoof",
    }),
  );
  assert.ok(statements.every((s) => !s.startsWith("UPDATE")));
});
test("each scenario exposes stable grounded highlights and drops malformed or ungrounded entries", () => {
  for (const [template, section, field] of [
    ["comment_insights", "demandRanking", "demand"],
    ["review_attribution", "issueClusters", "theme"],
    ["community_digest", "hotTopics", "topic"],
  ] as const) {
    const values = [
      null,
      { [field]: "No citation" },
      {
        [field]: "Grounded",
        citations: [
          { ref: "i1", snippet: "Original" },
          null,
          { ref: 1, snippet: "bad" },
        ],
      },
    ];
    assert.deepEqual(reportHighlights(template!, { [section!]: values }), [
      {
        key: `${section}:2`,
        title: "Grounded",
        detail: "",
        citations: [{ ref: "i1", snippet: "Original" }],
      },
    ]);
  }
});
