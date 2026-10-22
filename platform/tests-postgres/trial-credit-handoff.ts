import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client } from "pg";
import type { Database } from "../src/foundation/database";
import type { ActorContext } from "../src/contracts/domain";
import { TaskService } from "../src/task-service/service";
import { RunWorker } from "../src/run-service/worker-runner";
import { convertSubscribedTrial } from "../src/billing/trial-conversion";
import { reserveAiRun, usageSnapshot } from "../src/billing/guardrails";

export async function trialCreditHandoffRegression(
  t: TestContext,
  client: Client,
  database: Database,
) {
  const actor: ActorContext = {
    actorId: randomUUID(),
    workspaceId: randomUUID(),
    role: "owner",
  };
  await client.query(
    "INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Trial tester')",
    [actor.actorId, `trial-${actor.actorId}@example.invalid`],
  );
  await client.query(
    "INSERT INTO workspace(id,name,slug) VALUES($1,'Trial credit test',$2)",
    [actor.workspaceId, `trial-${actor.workspaceId}`],
  );
  await client.query(
    "INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner')",
    [actor.workspaceId, actor.actorId],
  );
  await client.query(
    `INSERT INTO workspace_billing(workspace_id,plan,subscription_status,trial_started_at,trial_ends_at,stripe_customer_id,stripe_subscription_id,stripe_price_id)
    VALUES($1,'creator','trialing',now()-interval '1 day',now()+interval '6 days','cus_handoff','sub_handoff','price_handoff')`,
    [actor.workspaceId],
  );
  let remoteStatus = "trialing",
    failPayment = true,
    invoiceStatus = "paid",
    calls = 0,
    remotePosts = 0;
  const subscription = () => ({
    id: "sub_handoff",
    customer: "cus_handoff",
    status: remoteStatus,
    collection_method: "charge_automatically",
    metadata: { workspaceId: actor.workspaceId },
    items: { data: [{ price: { id: "price_handoff" } }] },
    latest_invoice: {
      id: "in_handoff",
      customer: "cus_handoff",
      subscription: "sub_handoff",
      status: invoiceStatus,
      billing_reason: "subscription_cycle",
    },
  });
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init?: RequestInit) => {
      assert.ok(
        url.startsWith("https://api.stripe.com/v1/subscriptions/sub_handoff"),
      );
      if (init?.method === "POST") {
        remotePosts++;
        assert.equal(
          new URLSearchParams(String(init.body)).get("trial_end"),
          "now",
        );
        assert.equal(
          new Headers(init.headers).get("Idempotency-Key"),
          "trial-credit-handoff:sub_handoff:end",
        );
        if (failPayment)
          return Response.json(
            { error: { code: "card_declined" } },
            { status: 402 },
          );
        remoteStatus = "active";
      }
      return Response.json(subscription());
    },
  );
  await t.test(
    "trial credits stay cumulative across calendar months",
    async () => {
      await assert.rejects(
        database.withWorkspace(actor.workspaceId, async (tx) => {
          await tx.query(
            "UPDATE workspace_billing SET trial_started_at=date_trunc('month',now())-interval '1 day' WHERE workspace_id=$1",
            [actor.workspaceId],
          );
          await tx.query(
            "INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,trial_ai_credits,status,created_at) VALUES($1,$2,'test.trial',0,20,20,'succeeded',date_trunc('month',now())-interval '1 hour')",
            [actor.workspaceId, randomUUID()],
          );
          assert.equal((await usageSnapshot(tx)).aiCreditsAvailable, 10);
          throw new Error("rollback-trial-fixture");
        }),
        /rollback-trial-fixture/,
      );
    },
  );
  const tasks = new TaskService(database);
  const task = await tasks.create(actor, {
    requestId: randomUUID(),
    goal: "Find and summarize onboarding issues",
    modelBand: "flagship",
  });
  await tasks.message(actor, task.id, {
    requestId: randomUUID(),
    message: "Analyze onboarding",
    expectedVersion: 0,
    modelBand: "flagship",
  });
  const worker = new RunWorker({
    workerName: "trial-test",
    stripeSecretKey: "test-only",
    database: {
      withWorkspace: database.withWorkspace.bind(database),
      claimNextJob: async () => {
        return (
          await client.query(
            `UPDATE job SET status='running',attempt=attempt+1,locked_at=now(),locked_by='trial-test'
      WHERE id=(SELECT id FROM job WHERE workspace_id=$1 AND kind='task.turn' AND status='queued' AND available_at<=now() ORDER BY created_at LIMIT 1)
      RETURNING id,workspace_id AS "workspaceId",run_id AS "runId",kind,payload,attempt`,
            [actor.workspaceId],
          )
        ).rows[0];
      },
    },
    aiRuntime: {
      async taskStep() {
        calls++;
        return calls === 1
          ? {
              action: "search",
              query: "onboarding guide",
              answer: "",
              citations: [],
            }
          : {
              action: "answer",
              markdown: "No source evidence was supplied.",
              citations: [],
            };
      },
      async prepareAnnouncement() {
        throw new Error("unexpected");
      },
      async getAnnouncementRun() {
        throw new Error("unexpected");
      },
      async classifyItems() {
        throw new Error("unexpected");
      },
      async generateInsightReport() {
        throw new Error("unexpected");
      },
    },
  });
  await t.test(
    "trial first step runs on Flagship; declined conversion neither charges credits nor downgrades",
    async () => {
      await worker.runOne();
      assert.equal(calls, 1);
      assert.equal(remotePosts, 1);
      const usage = await database.withWorkspace(
        actor.workspaceId,
        usageSnapshot,
      );
      assert.equal(usage.aiCreditsAvailable, 10);
      assert.equal(usage.subscriptionStatus, "trialing");
      const events = await client.query(
        "SELECT ai_credits,trial_ai_credits,model_band FROM task_event WHERE workspace_id=$1",
        [actor.workspaceId],
      );
      assert.equal(events.rowCount, 1);
      assert.equal(Number(events.rows[0].trial_ai_credits), 20);
      assert.equal(events.rows[0].model_band, "flagship");
      const job = (
        await client.query(
          "SELECT status,last_error,payload FROM job WHERE workspace_id=$1",
          [actor.workspaceId],
        )
      ).rows[0];
      assert.equal(job.status, "queued");
      assert.equal(job.last_error, "model_choice_required");
      assert.equal(job.payload.modelChoice.reason, "trial_payment");
    },
  );
  await t.test(
    "an early active webhook cannot unlock unpaid plan credits",
    async () => {
      await client.query(
        "UPDATE workspace_billing SET subscription_status='active' WHERE workspace_id=$1",
        [actor.workspaceId],
      );
      const usage = await database.withWorkspace(
        actor.workspaceId,
        usageSnapshot,
      );
      assert.equal(usage.trialPaymentPending, true);
      assert.equal(usage.aiCreditsAvailable, 0);
      assert.equal(usage.status, "paused");
      await assert.rejects(
        tasks.create(actor, {
          requestId: randomUUID(),
          goal: "Unpaid bypass",
          modelBand: "flagship",
        }),
        /automation_paused/,
      );
      await client.query(
        "UPDATE workspace_billing SET subscription_status='trialing' WHERE workspace_id=$1",
        [actor.workspaceId],
      );
    },
  );
  await t.test(
    "confirmed Stripe payment resumes the original step; crossing allocation is 10 trial + 10 paid",
    async () => {
      failPayment = false;
      // Simulate an old PR #110 trial job still asking for a model downgrade.
      await client.query(
        "UPDATE job SET payload=jsonb_set(payload,'{modelChoice,reason}','\"credits\"'::jsonb) WHERE workspace_id=$1",
        [actor.workspaceId],
      );
      const { ModelChoiceService } =
        await import("../src/billing/model-choice");
      const service = new ModelChoiceService(database, "test-only");
      const pending = await service.list(actor);
      assert.equal(pending[0].reason, "trial_payment");
      assert.deepEqual(pending[0].choices, ["flagship"]);
      await service.choose(actor, pending[0].id, {
        modelBand: "flagship",
        reason: "Continue original model with subscribed trial handoff",
      });
      await worker.runOne();
      assert.equal(calls, 1); // Worker confirms payment and requeues the unchanged step.
      await worker.runOne();
      assert.equal(calls, 2);
      const events = await client.query(
        "SELECT ai_credits,trial_ai_credits,model_band FROM task_event WHERE workspace_id=$1 ORDER BY created_at",
        [actor.workspaceId],
      );
      assert.equal(events.rowCount, 2);
      assert.deepEqual(
        events.rows.map((e) => [
          Number(e.ai_credits),
          Number(e.trial_ai_credits),
          e.model_band,
        ]),
        [
          [20, 20, "flagship"],
          [20, 10, "flagship"],
        ],
      );
      const usage = await database.withWorkspace(
        actor.workspaceId,
        usageSnapshot,
      );
      assert.equal(usage.subscriptionStatus, "active");
      assert.equal(usage.aiCreditsUsed, 10);
      assert.equal(usage.aiCreditsAvailable, 390);
      assert.equal(usage.trialCreditCarryover, 0);
      assert.equal(
        (await tasks.detail(actor, task.id)).task.status,
        "completed",
      );
    },
  );
  await t.test(
    "concurrent reconciliation cannot replenish trial credits or charge Stripe again",
    async () => {
      const before = remotePosts;
      await Promise.all(
        [1, 2, 3].map(() =>
          database.withWorkspace(actor.workspaceId, (tx) =>
            convertSubscribedTrial(tx, actor.workspaceId, "test-only"),
          ),
        ),
      );
      assert.equal(remotePosts, before);
      assert.equal(
        (await database.withWorkspace(actor.workspaceId, usageSnapshot))
          .aiCreditsAvailable,
        390,
      );
    },
  );
  await t.test(
    "a delayed trial webhook cannot restore trial status or refill free credits",
    async () => {
      const { activateStripeSubscription } =
        await import("../src/billing/guardrails");
      await database.withWorkspace(actor.workspaceId, (tx) =>
        activateStripeSubscription(tx, {
          eventId: randomUUID(),
          eventType: "checkout.session.completed",
          plan: "creator",
          customerId: "cus_handoff",
          subscriptionId: "sub_handoff",
          priceId: "price_handoff",
          subscriptionStatus: "trialing",
          trialStartsAt: new Date(Date.now() - 86400000).toISOString(),
          trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      );
      const usage = await database.withWorkspace(
        actor.workspaceId,
        usageSnapshot,
      );
      assert.equal(usage.subscriptionStatus, "active");
      assert.equal(usage.aiCreditsAvailable, 390);
    },
  );
  await t.test(
    "only an insufficient paid balance triggers model choice after handoff",
    async () => {
      await client.query(
        "INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status) VALUES($1,$2,'test.seed',0,371,'succeeded')",
        [actor.workspaceId, randomUUID()],
      );
      await assert.rejects(
        database.withWorkspace(actor.workspaceId, (tx) =>
          reserveAiRun(
            tx,
            ["flagship"],
            { subjectId: randomUUID() },
            "flagship",
          ),
        ),
        /model_choice_required/,
      );
      assert.equal(
        (await database.withWorkspace(actor.workspaceId, usageSnapshot))
          .aiCreditsAvailable,
        19,
      );
    },
  );
  await t.test(
    "an active subscription with an unpaid invoice cannot grant the paid handoff",
    async () => {
      invoiceStatus = "uncollectible";
      assert.equal(
        await database.withWorkspace(actor.workspaceId, (tx) =>
          convertSubscribedTrial(tx, actor.workspaceId, "test-only"),
        ),
        false,
      );
    },
  );
  await t.test(
    "owner payment recovery commits reconciliation before asking for a cheaper paid model",
    async () => {
      const { ModelChoiceService } =
        await import("../src/billing/model-choice");
      invoiceStatus = "paid";
      const id = randomUUID();
      await client.query(
        "INSERT INTO job(id,workspace_id,kind,status,payload,last_error,available_at) VALUES($1,$2,'task.turn','queued',$3,'model_choice_required','infinity')",
        [
          id,
          actor.workspaceId,
          {
            taskId: task.id,
            modelChoice: {
              requestedBand: "flagship",
              reason: "trial_payment",
              trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
            },
          },
        ],
      );
      const service = new ModelChoiceService(database, "test-only");
      const response = await service.choose(actor, id, {
        modelBand: "flagship",
        reason: "Resume original model after payment",
        requestId: randomUUID(),
      });
      assert.equal("modelChoiceRequired" in response, true);
      const choices = await service.list(actor);
      assert.equal(choices[0].reason, "credits");
      assert.deepEqual(choices[0].choices, ["eco", "standard"]);
      await service.choose(actor, id, {
        modelBand: "standard",
        reason: "Confirm Standard for remaining paid steps",
      });
      const job = (
        await client.query("SELECT payload,last_error FROM job WHERE id=$1", [
          id,
        ])
      ).rows[0];
      assert.equal(job.last_error, null);
      assert.equal(job.payload.modelBandOverride, "standard");
    },
  );
  fetchMock.mock.restore();
}
