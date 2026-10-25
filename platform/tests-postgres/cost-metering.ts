import { ingestAiRuntimeEvent } from "../src/run-service/repository";
import { TaskService } from "../src/task-service/service";
import { RunWorker, type ClaimedJob } from "../src/run-service/worker-runner";
import { AiRuntimeClient } from "../src/ai-runtime/client";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client } from "pg";
import type { Database } from "../src/foundation/database";
import {
  quoteCost,
  bindCostQuote,
  costContext,
  receiveCostReceipts,
  finishCost,
  costOperations,
  expireCost,
} from "../src/billing/cost-metering";
import {
  projectedActionUsage,
  reserveAiRun,
  usageSnapshot,
} from "../src/billing/guardrails";
import {
  settleAiReservations,
  refundAiReservations,
} from "../src/billing/ai-refunds";
const rate = {
  version: "fixture-v1",
  model: "fixture-model",
  responseModels: ["fixture-model"],
  inputUsdPerMillion: "2",
  outputUsdPerMillion: "10",
  cacheUsdPerMillion: "0.2",
  source: "test fixture only",
  verifiedAt: "2026-10-24T00:00:00Z",
};
export async function costMeteringRegression(
  t: TestContext,
  client: Client,
  db: Database,
) {
  const env = {
    mode: process.env.AI_METERING_MODE,
    rates: process.env.AI_METERING_RATES_JSON,
  };
  process.env.AI_METERING_MODE = "cost-v1";
  process.env.AI_METERING_RATES_JSON = JSON.stringify({
    eco: rate,
    standard: rate,
    flagship: rate,
  });
  const workspaceId = randomUUID(),
    actorId = randomUUID(),
    actor = { workspaceId, actorId, role: "owner" as const };
  await client.query(
    "INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Cost tester')",
    [actorId, actorId + "@example.invalid"],
  );
  await client.query(
    "INSERT INTO workspace(id,name,slug) VALUES($1,'Metering tests',$2)",
    [workspaceId, "cost-" + workspaceId],
  );
  await client.query(
    "INSERT INTO workspace_billing(workspace_id,period_start,plan,subscription_status,purchased_ai_credits) VALUES($1,date_trunc('month',now())::date,'creator','active',100)",
    [workspaceId],
  );
  const available = () => db.withWorkspace(workspaceId, usageSnapshot);
  const setup = async (maxCredits = 30) => {
    const subjectId = randomUUID(),
      q = await quoteCost(db, actor, {
        kind: "task.turn",
        modelBand: "flagship",
        maxCredits,
      });
    if (!("quoteId" in q)) throw new Error("no quote");
    await db.withWorkspace(workspaceId, (tx) =>
      bindCostQuote(
        tx,
        actor,
        { aiQuoteId: q.quoteId },
        subjectId,
        "flagship",
        "task.turn",
      ),
    );
    return { subjectId, quote: q };
  };
  const call = async (
    subjectId: string,
    attempt = 1,
    input = 1000,
    output = 800,
  ) =>
    costContext.run({ workspaceId, database: db }, async () => {
      await db.withWorkspace(workspaceId, (tx) =>
        reserveAiRun(
          tx,
          ["flagship"],
          { subjectId, actionType: "ai.task", attempt },
          "flagship",
        ),
      );
      const envelope = costContext.getStore()!.envelope!;
      assert.ok(envelope);
      await db.withWorkspace(workspaceId, (tx) =>
        receiveCostReceipts(tx, workspaceId, [
          {
            id: randomUUID(),
            requestId: envelope.requestId,
            operationId: envelope.operationId,
            workspaceId,
            model: "fixture-model",
            input,
            output,
            cached: 0,
            costNanos: null,
            status: "known",
          },
        ]),
      );
      return envelope;
    });
  t.beforeEach(async () => {
    process.env.AI_METERING_MODE = "cost-v1";
    for (const table of [
      "ai_cost_journal",
      "ai_cost_receipt",
      "ai_cost_request",
      "ai_cost_operation",
      "task_event",
    ])
      await client.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [
        workspaceId,
      ]);
    await client.query(
      "UPDATE workspace_billing SET subscription_status='active',purchased_ai_credits=100,trial_credit_carryover=0,trial_started_at=NULL,credit_refund_debt=0 WHERE workspace_id=$1",
      [workspaceId],
    );
  });
  try {
    await t.test(
      "unreserved accepted quote failure cannot create a refund",
      async () => {
        const before = await available(),
          op = await setup();
        await db.withWorkspace(workspaceId, (tx) =>
          finishCost(tx, op.subjectId, true),
        );
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable,
        );
      },
    );
    await t.test(
      "reserves the maximum, cumulatively settles valid receipts and releases the difference once",
      async () => {
        const before = await available(),
          op = await setup();
        await call(op.subjectId);
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable - 30,
        );
        await db.withWorkspace(workspaceId, (tx) =>
          settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
            attempt: 1,
          }),
        );
        await Promise.all(
          [1, 2].map(() =>
            db.withWorkspace(workspaceId, (tx) => finishCost(tx, op.subjectId)),
          ),
        );
        const after = await available();
        assert.equal(after.aiCreditsAvailable, before.aiCreditsAvailable - 12);
        assert.equal(after.aiCreditsHeld, 0);
        const rows = await db.withWorkspace(workspaceId, (tx) =>
          costOperations(tx),
        );
        const row = rows.find((r) => r.subjectId === op.subjectId)!;
        assert.equal(row.settledCredits, 12);
        assert.equal(row.releasedCredits, 18);
      },
    );
    await t.test(
      "two tiny model calls round once for their parent operation",
      async () => {
        const op = await setup(),
          before = await available();
        for (let attempt = 1; attempt <= 2; attempt++) {
          await call(op.subjectId, attempt, 50, 0);
          await db.withWorkspace(workspaceId, (tx) =>
            settleAiReservations(tx, {
              subjectId: op.subjectId,
              actionType: "ai.task",
              attempt,
            }),
          );
        }
        await db.withWorkspace(workspaceId, (tx) =>
          finishCost(tx, op.subjectId),
        );
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable - 1,
        );
      },
    );
    await t.test(
      "a failed later step keeps saved valid results but refunds the remaining hold",
      async () => {
        const op = await setup(),
          before = await available();
        await call(op.subjectId);
        await db.withWorkspace(workspaceId, (tx) =>
          settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
            attempt: 1,
          }),
        );
        await call(op.subjectId, 2);
        await db.withWorkspace(workspaceId, (tx) =>
          refundAiReservations(tx, { subjectId: op.subjectId }, "failed_step"),
        );
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable - 12,
        );
        await db.withWorkspace(workspaceId, (tx) =>
          refundAiReservations(tx, { subjectId: op.subjectId }, "duplicate"),
        );
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable - 12,
        );
      },
    );
    await t.test(
      "unknown usage is held for reconciliation then returned after the timeout",
      async () => {
        const op = await setup(),
          before = await available();
        await costContext.run({ workspaceId, database: db }, async () => {
          await db.withWorkspace(workspaceId, (tx) =>
            reserveAiRun(
              tx,
              ["flagship"],
              { subjectId: op.subjectId, actionType: "ai.task" },
              "flagship",
            ),
          );
        });
        await db.withWorkspace(workspaceId, (tx) =>
          settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
          }),
        );
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable - 30,
        );
        await client.query(
          "UPDATE ai_cost_operation SET created_at=now()-interval '25 hours' WHERE id=$1",
          [op.quote.quoteId],
        );
        await db.withWorkspace(workspaceId, expireCost);
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable,
        );
      },
    );
    await t.test(
      "shadow mode measures rates without changing the existing 20-credit charge",
      async () => {
        process.env.AI_METERING_MODE = "shadow";
        const op = await setup(),
          before = await available();
        await call(op.subjectId);
        await db.withWorkspace(workspaceId, (tx) =>
          settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
          }),
        );
        await db.withWorkspace(workspaceId, (tx) =>
          finishCost(tx, op.subjectId),
        );
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable - 20,
        );
        process.env.AI_METERING_MODE = "cost-v1";
      },
    );
    await t.test(
      "mixed trial carryover, included and purchased funds settle and return to the correct buckets",
      async () => {
        await client.query(
          "UPDATE workspace_billing SET trial_credit_carryover=4,trial_started_at=now()-interval '1 day' WHERE workspace_id=$1",
          [workspaceId],
        );
        await client.query(
          "INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status,ai_reservation_state,purchased_ai_credits) VALUES($1,$2,'ai.seed',0,380,'succeeded','settled',0)",
          [workspaceId, randomUUID()],
        );
        const before = await available(),
          op = await setup(40);
        await call(op.subjectId);
        let wallet = await client.query(
          "SELECT purchased_ai_credits,trial_credit_carryover FROM workspace_billing WHERE workspace_id=$1",
          [workspaceId],
        );
        assert.equal(Number(wallet.rows[0].purchased_ai_credits), 84);
        assert.equal(Number(wallet.rows[0].trial_credit_carryover), 0);
        await db.withWorkspace(workspaceId, (tx) =>
          settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
          }),
        );
        await db.withWorkspace(workspaceId, (tx) =>
          finishCost(tx, op.subjectId),
        );
        wallet = await client.query(
          "SELECT purchased_ai_credits FROM workspace_billing WHERE workspace_id=$1",
          [workspaceId],
        );
        assert.equal(Number(wallet.rows[0].purchased_ai_credits), 100);
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable - 12,
        );
      },
    );
    await t.test("expired quote cannot bind or create a charge", async () => {
      const q = await quoteCost(db, actor, {
        kind: "task.turn",
        modelBand: "flagship",
        maxCredits: 20,
      });
      if (!("quoteId" in q)) throw new Error("no quote");
      await client.query(
        "UPDATE ai_cost_operation SET expires_at=now()-interval '1 second' WHERE id=$1",
        [q.quoteId],
      );
      const before = await available();
      await assert.rejects(
        db.withWorkspace(workspaceId, (tx) =>
          bindCostQuote(
            tx,
            actor,
            { aiQuoteId: q.quoteId },
            randomUUID(),
            "flagship",
            "task.turn",
          ),
        ),
      );
      assert.equal(
        (await available()).aiCreditsAvailable,
        before.aiCreditsAvailable,
      );
    });
    await t.test(
      "two concurrent operations cannot reserve the same final credits",
      async () => {
        await client.query(
          "INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status,ai_reservation_state,purchased_ai_credits) VALUES($1,$2,'ai.seed',0,380,'succeeded','settled',0)",
          [workspaceId, randomUUID()],
        );
        const a = await setup(80),
          b = await setup(80);
        const results = await Promise.allSettled(
          [a, b].map((op) =>
            costContext.run({ workspaceId, database: db }, () =>
              db.withWorkspace(workspaceId, (tx) =>
                reserveAiRun(
                  tx,
                  ["flagship"],
                  { subjectId: op.subjectId, actionType: "ai.task" },
                  "flagship",
                ),
              ),
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(results.filter((r) => r.status === "rejected").length, 1);
        await db.withWorkspace(workspaceId, async (tx) => {
          await finishCost(tx, a.subjectId, true);
          await finishCost(tx, b.subjectId, true);
        });
      },
    );
    await t.test(
      "new metering tables force real tenant RLS for a non-superuser",
      async () => {
        const op = await setup(),
          role = "cost_rls_" + randomUUID().replaceAll("-", "");
        await client.query(`CREATE ROLE ${role} NOLOGIN`);
        await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await client.query(
          `GRANT SELECT ON ai_cost_operation,ai_cost_request,ai_cost_receipt,ai_cost_journal,ai_cost_legacy_subject TO ${role}`,
        );
        await client.query("BEGIN");
        try {
          await client.query("SELECT set_config('app.workspace_id',$1,true)", [
            randomUUID(),
          ]);
          await client.query(`SET LOCAL ROLE ${role}`);
          assert.equal(
            (
              await client.query(
                "SELECT count(*) FROM ai_cost_operation WHERE id=$1",
                [op.quote.quoteId],
              )
            ).rows[0].count,
            "0",
          );
        } finally {
          await client.query("ROLLBACK");
          await client.query(`DROP OWNED BY ${role}`);
          await client.query(`DROP ROLE ${role}`);
        }
      },
    );
    await t.test(
      "a valid result with one unknown subreceipt settles the verified part and only releases the unresolved remainder",
      async () => {
        const op = await setup(),
          before = await available(),
          e = await call(op.subjectId);
        await db.withWorkspace(workspaceId, (tx) =>
          receiveCostReceipts(tx, workspaceId, [
            {
              id: randomUUID(),
              requestId: e.requestId,
              operationId: e.operationId,
              workspaceId,
              model: "fixture-model",
              input: null,
              output: null,
              cached: null,
              costNanos: null,
              status: "unknown",
            },
          ]),
        );
        await db.withWorkspace(workspaceId, (tx) =>
          settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
          }),
        );
        let receipt = (
          await db.withWorkspace(workspaceId, (tx) => costOperations(tx))
        )[0]!;
        assert.equal(receipt.state, "reconciliation");
        assert.equal(receipt.settledCredits, 12);
        assert.equal(receipt.heldCredits, 18);
        await client.query(
          "UPDATE ai_cost_operation SET created_at=now()-interval '25 hours' WHERE id=$1",
          [op.quote.quoteId],
        );
        await db.withWorkspace(workspaceId, expireCost);
        assert.equal(
          (await available()).aiCreditsAvailable,
          before.aiCreditsAvailable - 12,
        );
      },
    );
    await t.test(
      "a prior-period refund restores purchased funds without creating another monthly allowance",
      async () => {
        await client.query(
          "INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status,ai_reservation_state,purchased_ai_credits) VALUES($1,$2,'ai.seed',0,380,'succeeded','settled',0)",
          [workspaceId, randomUUID()],
        );
        const op = await setup(40);
        await call(op.subjectId);
        await client.query(
          "UPDATE task_event SET credit_period=(date_trunc('month',now())-interval '1 month')::date WHERE workspace_id=$1",
          [workspaceId],
        );
        await client.query(
          "UPDATE ai_cost_operation SET credit_period=(date_trunc('month',now())-interval '1 month')::date WHERE id=$1",
          [op.quote.quoteId],
        );
        await client.query(
          "UPDATE ai_cost_journal SET credit_period=(date_trunc('month',now())-interval '1 month')::date WHERE workspace_id=$1",
          [workspaceId],
        );
        await db.withWorkspace(workspaceId, (tx) =>
          finishCost(tx, op.subjectId, true),
        );
        assert.equal((await available()).aiCreditsAvailable, 500);
        assert.equal((await available()).includedCreditsRemaining, 400);
      },
    );
    await t.test(
      "trial reservations remain cumulative across a month boundary and cannot consume purchased funds",
      async () => {
        await client.query(
          "UPDATE workspace_billing SET subscription_status='trialing',trial_started_at=now()-interval '2 days',trial_ends_at=now()+interval '5 days' WHERE workspace_id=$1",
          [workspaceId],
        );
        const op = await setup(30);
        await call(op.subjectId);
        await db.withWorkspace(workspaceId, (tx) =>
          settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
          }),
        );
        await db.withWorkspace(workspaceId, (tx) =>
          finishCost(tx, op.subjectId),
        );
        await client.query(
          "UPDATE ai_cost_journal SET credit_period=(date_trunc('month',now())-interval '1 month')::date WHERE workspace_id=$1",
          [workspaceId],
        );
        assert.equal((await available()).trialCreditsRemaining, 18);
        assert.equal(
          Number(
            (
              await client.query(
                "SELECT purchased_ai_credits FROM workspace_billing WHERE workspace_id=$1",
                [workspaceId],
              )
            ).rows[0].purchased_ai_credits,
          ),
          100,
        );
        const next = await setup(19);
        await assert.rejects(call(next.subjectId));
        assert.equal((await available()).trialCreditsRemaining, 18);
      },
    );
    await t.test(
      "the same versioned formula applies to all three selected capability bands",
      async () => {
        for (const modelBand of ["eco", "standard", "flagship"] as const) {
          const subjectId = randomUUID(),
            quote = await quoteCost(db, actor, {
              kind: "insight.generate",
              modelBand,
              maxCredits: 30,
            });
          if (!("quoteId" in quote)) throw new Error("no quote");
          await db.withWorkspace(workspaceId, (tx) =>
            bindCostQuote(
              tx,
              actor,
              { aiQuoteId: quote.quoteId },
              subjectId,
              modelBand,
              "insight.generate",
            ),
          );
          await costContext.run({ workspaceId, database: db }, async () => {
            await db.withWorkspace(workspaceId, (tx) =>
              reserveAiRun(
                tx,
                [modelBand],
                { subjectId, actionType: "ai.insight" },
                modelBand,
              ),
            );
            const e = costContext.getStore()!.envelope!;
            await db.withWorkspace(workspaceId, (tx) =>
              receiveCostReceipts(tx, workspaceId, [
                {
                  id: randomUUID(),
                  requestId: e.requestId,
                  operationId: e.operationId,
                  workspaceId,
                  model: "fixture-model",
                  input: 1000,
                  output: 800,
                  cached: 0,
                  costNanos: null,
                  status: "known",
                },
              ]),
            );
          });
          await db.withWorkspace(workspaceId, async (tx) => {
            await settleAiReservations(tx, {
              subjectId,
              actionType: "ai.insight",
            });
            await finishCost(tx, subjectId);
          });
        }
        assert.equal((await available()).aiCreditsAvailable, 464);
      },
    );
    await t.test(
      "real task submission, worker context, receipt transport and saved result settle as one operation",
      async () => {
        await client.query(
          "INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
          [workspaceId, actorId],
        );
        const service = new TaskService(db),
          task = await service.create(actor, {
            goal: "Write a welcome note",
            modelBand: "flagship",
            language: "en",
            requestId: randomUUID(),
          });
        const quote = await quoteCost(db, actor, {
          kind: "task.turn",
          modelBand: "flagship",
          maxCredits: 30,
        });
        if (!("quoteId" in quote)) throw new Error("no quote");
        await service.message(actor, task.id, {
          message: "Write a welcome note",
          modelBand: "flagship",
          expectedVersion: 0,
          requestId: randomUUID(),
          aiQuoteId: quote.quoteId,
        });
        let calls = 0;
        const runtime = new AiRuntimeClient({
          baseUrl: "http://runtime.invalid",
          internalToken: "test-only",
          fetchImpl: async (_url, init) => {
            calls++;
            const body = JSON.parse(String(init?.body)),
              e = body._metering;
            assert.ok(e);
            assert.equal(e.operationId, quote.quoteId);
            assert.equal(body.modelBand, "flagship");
            return Response.json({
              action: "answer",
              query: "",
              markdown: "Welcome to the community.",
              citations: [],
              _metering: [
                {
                  id: randomUUID(),
                  requestId: e.requestId,
                  operationId: e.operationId,
                  workspaceId,
                  model: "fixture-model",
                  input: 1000,
                  output: 800,
                  cached: 0,
                  costNanos: null,
                  status: "known",
                },
              ],
            });
          },
        });
        const worker = new RunWorker({
          workerName: "metering-e2e",
          database: {
            withWorkspace: (id, fn) => db.withWorkspace(id, fn),
            claimNextJob: () =>
              db.withWorkspace(workspaceId, async (tx) => {
                const r = await tx.query<ClaimedJob>(
                  `UPDATE job SET status='running',attempt=attempt+1,locked_at=now(),locked_by='metering-e2e' WHERE id=(SELECT id FROM job WHERE workspace_id=$1 AND kind='task.turn' AND status='queued' AND payload->>'taskId'=$2 LIMIT 1) RETURNING id,workspace_id AS "workspaceId",run_id AS "runId",kind,payload,attempt`,
                  [workspaceId, task.id],
                );
                return r.rows[0];
              }),
          },
          aiRuntime: runtime,
        });
        await worker.runOne();
        const detail = await service.detail(actor, task.id);
        assert.equal(detail.task.status, "completed");
        assert.equal(calls, 1);
        assert.equal((await available()).aiCreditsAvailable, 488);
        const receipt = (
          await db.withWorkspace(workspaceId, (tx) => costOperations(tx))
        )[0]!;
        assert.equal(receipt.settledCredits, 12);
        assert.equal(receipt.heldCredits, 0);
      },
    );
    await t.test(
      "AI topups do not disable the separate external-action hard limit",
      async () => {
        await client.query(
          "INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,supplier_cost_micros,status,ai_reservation_state,purchased_ai_credits) VALUES($1,$2,'ai.legacy',0,0,999999999,'succeeded','settled',0),($1,$3,'social.create_post',1,0,6000000,'succeeded','settled',0)",
          [workspaceId, randomUUID(), randomUUID()],
        );
        const snapshot = await available();
        assert.equal(snapshot.supplierSpendLimitMicros, 6000000);
        assert.equal(snapshot.supplierSpendMicros, 6000000);
        assert.equal(snapshot.externalActionStatus, "paused");
        assert.equal(snapshot.status, "normal");
        const projected = await db.withWorkspace(workspaceId, (tx) =>
          projectedActionUsage(tx, {
            actionType: "social.create_post",
            platform: "x",
            payload: { content: "https://example.invalid" },
          }),
        );
        assert.equal(projected.status, "paused");
        const op = await setup();
        await call(op.subjectId);
        await db.withWorkspace(workspaceId, (tx) =>
          finishCost(tx, op.subjectId, true),
        );
        assert.equal((await available()).aiCreditsAvailable, 500);
      },
    );
    await t.test(
      "a confirmed continuation of the same business subject does not round another minimum credit",
      async () => {
        const op = await setup();
        await call(op.subjectId, 1, 50, 0);
        await db.withWorkspace(workspaceId, async (tx) => {
          await settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
          });
          await finishCost(tx, op.subjectId);
        });
        const q = await quoteCost(db, actor, {
          kind: "task.turn",
          modelBand: "flagship",
          maxCredits: 30,
        });
        if (!("quoteId" in q)) throw new Error("no quote");
        await db.withWorkspace(workspaceId, (tx) =>
          bindCostQuote(
            tx,
            actor,
            { aiQuoteId: q.quoteId },
            op.subjectId,
            "flagship",
            "task.turn",
          ),
        );
        await call(op.subjectId, 2, 50, 0);
        await db.withWorkspace(workspaceId, async (tx) => {
          await settleAiReservations(tx, {
            subjectId: op.subjectId,
            actionType: "ai.task",
            attempt: 2,
          });
          await finishCost(tx, op.subjectId);
        });
        assert.equal((await available()).aiCreditsAvailable, 499);
        assert.equal(
          (
            await db.withWorkspace(workspaceId, (tx) => costOperations(tx))
          ).reduce((sum, row) => sum + Number(row.settledCredits), 0),
          1,
        );
      },
    );
    await t.test(
      "asynchronous workflow budget exhaustion waits for a new quote, and a stale callback cannot pause its successor",
      async () => {
        const workflow = randomUUID(),
          subject = randomUUID();
        await client.query(
          "INSERT INTO workflow(id,workspace_id,name,created_by) VALUES($1,$2,'Metered publish',$3)",
          [workflow, workspaceId, actorId],
        );
        await client.query(
          "INSERT INTO workflow_version(workflow_id,version,definition,created_by) VALUES($1,1,'{}',$2)",
          [workflow, actorId],
        );
        await client.query(
          "INSERT INTO workflow_run(id,workspace_id,workflow_id,workflow_version,status,idempotency_key,input,context_snapshot,requested_by) VALUES($1,$2,$3,1,'running',$1::uuid::text,'{}','{}',$4)",
          [subject, workspaceId, workflow, actorId],
        );
        await client.query(
          "INSERT INTO job(workspace_id,run_id,kind,status,payload) VALUES($1,$2,'prepare_ai_run','succeeded','{}')",
          [workspaceId, subject],
        );
        const quote = await quoteCost(db, actor, {
          kind: "prepare_ai_run",
          modelBand: "flagship",
          maxCredits: 30,
        });
        if (!("quoteId" in quote)) throw new Error("no quote");
        await db.withWorkspace(workspaceId, (tx) =>
          bindCostQuote(
            tx,
            actor,
            { aiQuoteId: quote.quoteId },
            subject,
            "flagship",
            "prepare_ai_run",
          ),
        );
        await costContext.run({ workspaceId, database: db }, () =>
          db.withWorkspace(workspaceId, (tx) =>
            reserveAiRun(tx, ["flagship"], { runId: subject }, "flagship"),
          ),
        );
        const event = {
          eventId: "budget:" + randomUUID(),
          workspaceId,
          platformRunId: subject,
          aiRunId: randomUUID(),
          type: "ai_run.failed" as const,
          createdAt: new Date().toISOString(),
          payload: {
            error: "ai_confirmed_budget_exhausted",
            _meteringOperationId: quote.quoteId,
          },
        };
        await db.withWorkspace(workspaceId, (tx) =>
          ingestAiRuntimeEvent(tx, event),
        );
        let job = (
          await client.query(
            "SELECT status,last_error FROM job WHERE run_id=$1",
            [subject],
          )
        ).rows[0];
        assert.equal(job.status, "queued");
        assert.equal(job.last_error, "model_choice_required");
        assert.equal((await available()).aiCreditsAvailable, 470);
        await db.withWorkspace(workspaceId, (tx) =>
          finishCost(tx, subject, true),
        );
        await client.query(
          "UPDATE job SET status='running',last_error=NULL WHERE run_id=$1",
          [subject],
        );
        await db.withWorkspace(workspaceId, (tx) =>
          ingestAiRuntimeEvent(tx, {
            ...event,
            eventId: "late:" + randomUUID(),
          }),
        );
        job = (
          await client.query(
            "SELECT status,last_error FROM job WHERE run_id=$1",
            [subject],
          )
        ).rows[0];
        assert.equal(job.status, "running");
        assert.equal(job.last_error, null);
      },
    );
    await t.test(
      "cross-workspace quotes and forged receipt identity are rejected",
      async () => {
        const op = await setup();
        await assert.rejects(
          db.withWorkspace(randomUUID(), (tx) =>
            bindCostQuote(
              tx,
              { ...actor, workspaceId: randomUUID() },
              { aiQuoteId: op.quote.quoteId },
              randomUUID(),
              "flagship",
              "task.turn",
            ),
          ),
        );
        await assert.rejects(
          db.withWorkspace(workspaceId, (tx) =>
            receiveCostReceipts(tx, workspaceId, [
              {
                id: randomUUID(),
                workspaceId: randomUUID(),
                operationId: op.quote.quoteId,
                requestId: randomUUID(),
                model: "fixture-model",
                input: 1,
                output: 1,
                cached: 0,
                costNanos: null,
                status: "known",
              },
            ]),
          ),
          /workspace_mismatch/,
        );
      },
    );
  } finally {
    if (env.mode === undefined) delete process.env.AI_METERING_MODE;
    else process.env.AI_METERING_MODE = env.mode;
    if (env.rates === undefined) delete process.env.AI_METERING_RATES_JSON;
    else process.env.AI_METERING_RATES_JSON = env.rates;
  }
}
