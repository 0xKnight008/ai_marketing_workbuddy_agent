import assert from "node:assert/strict";
import type { MeterEnvelope } from "../../shared/ai-metering";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client } from "pg";
import type { Database } from "../src/foundation/database";
import type { GatewayConfig } from "../src/foundation/platform-config";
import type { PlatformOrm } from "../src/foundation/sequelize";
import { PlatformService } from "../src/egg/platform-service";
import { createPipelineDraft, listPipelines } from "../src/gateway/pipelines";
import { quoteCost, costContext } from "../src/billing/cost-metering";
import { usageSnapshot } from "../src/billing/guardrails";
import {
  ingestAiRuntimeEvent,
  decideApproval,
} from "../src/run-service/repository";
import { RunWorker, type ClaimedJob } from "../src/run-service/worker-runner";

export async function pipelineBillingRegression(
  t: TestContext,
  client: Client,
  db: Database,
) {
  const original = {
    mode: process.env.AI_METERING_MODE,
    rates: process.env.AI_METERING_RATES_JSON,
  };
  const rate = {
    version: "pipeline-fixture",
    model: "fixture",
    responseModels: ["fixture"],
    inputUsdPerMillion: "2",
    outputUsdPerMillion: "10",
    cacheUsdPerMillion: "0.2",
    source: "local synthetic test",
    verifiedAt: "2026-11-03T00:00:00Z",
  };
  process.env.AI_METERING_MODE = "cost-v1";
  process.env.AI_METERING_RATES_JSON = JSON.stringify({
    eco: rate,
    standard: rate,
    flagship: rate,
  });
  try {
    await t.test(
      "X pipeline goes from paid draft to approval to one confirmed publish; activation retries do not bind another quote",
      async () => {
        const actor = {
            workspaceId: randomUUID(),
            actorId: randomUUID(),
            role: "owner" as const,
          },
          accountId = randomUUID(),
          profile = randomUUID();
        await client.query(
          "INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Pipeline regression')",
          [actor.actorId, `${actor.actorId}@example.invalid`],
        );
        await client.query(
          "INSERT INTO workspace(id,name,slug) VALUES($1::uuid,'Pipeline test',$1::text)",
          [actor.workspaceId],
        );
        await client.query(
          "INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner')",
          [actor.workspaceId, actor.actorId],
        );
        await client.query(
          "INSERT INTO workspace_billing(workspace_id,period_start,plan,subscription_status) VALUES($1,date_trunc('month',now())::date,'growth','active')",
          [actor.workspaceId],
        );
        await client.query(
          "INSERT INTO zernio_tenant(workspace_id,profile_id) VALUES($1,$2)",
          [actor.workspaceId, profile],
        );
        await client.query(
          "INSERT INTO connected_account(id,workspace_id,provider,external_account_id,display_name,platform,capabilities,zernio_profile_id) VALUES($1,$2,'zernio','synthetic-x','Synthetic X','twitter','[\"publish\"]',$3)",
          [accountId, actor.workspaceId, profile],
        );
        const pipeline = await db.withWorkspace(actor.workspaceId, (tx) =>
          createPipelineDraft(tx, actor, {
            name: "X announcement",
            source: { type: "template", templateId: "repurpose" },
            configuration: {
              sourceText: "Our product now links original evidence.",
              goal: "Prepare a short X announcement.",
              brief: "Prepare a short product announcement for our X audience.",
              targetAccountIds: [accountId],
              modelBand: "eco",
            },
          }),
        );
        const service = new PlatformService(
          {} as GatewayConfig,
          db,
          {} as PlatformOrm,
        );
        const quote = async () => {
          const q = await quoteCost(db, actor, {
            kind: "prepare_ai_run",
            modelBand: "eco",
            maxCredits: 30,
          });
          if (!("quoteId" in q)) throw Error("quote missing");
          return q;
        };
        await assert.rejects(
          service.activatePipeline(actor, pipeline.id, { modelBand: "eco" }),
        );
        assert.equal(
          (
            await client.query("SELECT status FROM workflow WHERE id=$1", [
              pipeline.id,
            ])
          ).rows[0].status,
          "draft",
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM workflow_run WHERE workflow_id=$1",
              [pipeline.id],
            )
          ).rows[0].n,
          0,
        );
        const q = await quote();
        const first = (await service.activatePipeline(actor, pipeline.id, {
          modelBand: "eco",
          aiQuoteId: q.quoteId,
        })) as { run: { id: string; replayed?: boolean } };
        const restored = (
          await db.withWorkspace(actor.workspaceId, (tx) =>
            listPipelines(tx, actor),
          )
        )[0]!;
        assert.equal(restored.lastRunId, first.run.id);
        assert.equal(
          restored.definition.sourceText,
          "Our product now links original evidence.",
        );
        assert.equal(
          restored.definition.goal,
          "Prepare a short X announcement.",
        );
        const fresh = await quote();
        const second = (await service.activatePipeline(actor, pipeline.id, {
          modelBand: "eco",
          aiQuoteId: fresh.quoteId,
        })) as typeof first;
        const concurrent = await Promise.all([
          service.activatePipeline(actor, pipeline.id, {}),
          service.activatePipeline(actor, pipeline.id, {
            aiQuoteId: fresh.quoteId,
          }),
        ]);
        for (const item of concurrent)
          assert.equal((item as typeof first).run.id, first.run.id);
        assert.equal(first.run.id, second.run.id);
        assert.equal(second.run.replayed, true);
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM ai_cost_operation WHERE subject_id=$1",
              [first.run.id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await client.query(
              "SELECT state FROM ai_cost_operation WHERE id=$1",
              [fresh.quoteId],
            )
          ).rows[0].state,
          "quoted",
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM job WHERE run_id=$1 AND kind='prepare_ai_run'",
              [first.run.id],
            )
          ).rows[0].n,
          1,
        );
        let envelope: MeterEnvelope | undefined;
        let posts = 0;
        const workerName = "pipeline-test";
        const worker = new RunWorker({
          workerName,
          database: {
            withWorkspace: (id, fn) => db.withWorkspace(id, fn),
            claimNextJob: () =>
              db.withWorkspace(actor.workspaceId, async (tx) => {
                const r = await tx.query<ClaimedJob>(
                  "UPDATE job SET status='running',attempt=attempt+1,locked_by=$2,locked_at=now() WHERE id=(SELECT id FROM job WHERE run_id=$1 AND status='queued' AND kind IN ('prepare_ai_run','execute_approved_actions') ORDER BY created_at LIMIT 1) RETURNING id,workspace_id AS \"workspaceId\",run_id AS \"runId\",kind,payload,attempt",
                  [first.run.id, workerName],
                );
                return r.rows[0];
              }),
          },
          aiRuntime: {
            prepareAnnouncement: async () => {
              envelope = costContext.getStore()!.envelope;
              return { aiRunId: "synthetic-run", status: "accepted" };
            },
            getAnnouncementRun: async () => {
              throw Error("Unexpected reconciliation");
            },
            classifyItems: async () => {
              throw Error("Unexpected classification");
            },
            generateInsightReport: async () => {
              throw Error("Unexpected report");
            },
          },
          zernio: {
            executeAction: async (_key, action) => {
              posts++;
              return {
                postId: "synthetic-post",
                status: "published",
                platform: "twitter",
                accountId: action.accountId,
                platformPostUrl: "https://example.invalid/post",
              };
            },
          },
        });
        await worker.runOne();
        assert.ok(envelope);
        const receiptEnvelope = envelope;
        assert.equal(posts, 0);
        const plan = {
          summary: "Review X draft",
          requiresApproval: true,
          actions: [
            {
              stepOrder: 1,
              type: "social.create_post",
              platform: "x",
              accountId: "synthetic-x",
              content: "A synthetic product update, never sent to X.",
              hashtags: [],
              mode: "publish_now",
              idempotencyKey: first.run.id,
              requiresApproval: true,
            },
          ],
        };
        await db.withWorkspace(actor.workspaceId, (tx) =>
          ingestAiRuntimeEvent(tx, {
            eventId: randomUUID(),
            platformRunId: first.run.id,
            workspaceId: actor.workspaceId,
            aiRunId: "synthetic-run",
            type: "action_plan.created",
            createdAt: new Date().toISOString(),
            payload: {
              actionPlan: plan,
              _metering: [
                {
                  id: randomUUID(),
                  requestId: receiptEnvelope.requestId,
                  operationId: receiptEnvelope.operationId,
                  workspaceId: actor.workspaceId,
                  model: "fixture",
                  input: 1000,
                  output: 800,
                  cached: 0,
                  costNanos: null,
                  status: "known",
                },
              ],
            },
          }),
        );
        assert.equal(
          (
            await client.query("SELECT status FROM workflow_run WHERE id=$1", [
              first.run.id,
            ])
          ).rows[0].status,
          "waiting_approval",
        );
        assert.equal(posts, 0);
        const approval = (
          await client.query(
            "SELECT id FROM approval_request WHERE run_id=$1 AND status='pending'",
            [first.run.id],
          )
        ).rows[0];
        assert.ok(approval);
        assert.equal(
          (await db.withWorkspace(actor.workspaceId, usageSnapshot))
            .aiCreditsAvailable,
          2498,
        );
        for (let i = 0; i < 2; i++)
          await db.withWorkspace(actor.workspaceId, (tx) =>
            decideApproval(tx, actor, approval.id, "approved"),
          );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int n FROM job WHERE run_id=$1 AND kind='execute_approved_actions'",
              [first.run.id],
            )
          ).rows[0].n,
          1,
        );
        await worker.runOne();
        assert.equal(posts, 1);
        assert.equal(
          (
            await client.query("SELECT status FROM workflow_run WHERE id=$1", [
              first.run.id,
            ])
          ).rows[0].status,
          "succeeded",
        );
        await service.activatePipeline(actor, pipeline.id, {});
        assert.equal(await worker.runOne(), false);
        assert.equal(posts, 1);
        assert.equal(
          (await db.withWorkspace(actor.workspaceId, usageSnapshot))
            .aiCreditsAvailable,
          2498,
        );
      },
    );
  } finally {
    if (original.mode === undefined) delete process.env.AI_METERING_MODE;
    else process.env.AI_METERING_MODE = original.mode;
    if (original.rates === undefined) delete process.env.AI_METERING_RATES_JSON;
    else process.env.AI_METERING_RATES_JSON = original.rates;
  }
}
