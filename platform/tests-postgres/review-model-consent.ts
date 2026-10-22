import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client } from "pg";
import type { Database } from "../src/foundation/database";
import type { ActorContext } from "../src/contracts/domain";
import { decideApproval } from "../src/run-service/repository";
import { ImportService } from "../src/import-service/service";
import { TaskService } from "../src/task-service/service";
import { ModelChoiceService } from "../src/billing/model-choice";
import { RunWorker, type ClaimedJob } from "../src/run-service/worker-runner";
export async function reviewModelRegression(
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
    "INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Review model test')",
    [actor.actorId, `review-${actor.actorId}@example.invalid`],
  );
  await client.query(
    "INSERT INTO workspace(id,name,slug) VALUES($1,'Review test',$2)",
    [actor.workspaceId, actor.workspaceId],
  );
  await client.query(
    "INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner')",
    [actor.workspaceId, actor.actorId],
  );
  await client.query(
    "INSERT INTO workspace_billing(workspace_id,subscription_status,trial_ends_at) VALUES($1,'trialing',now()+interval '7 days')",
    [actor.workspaceId],
  );
  const workflow = (
    await client.query(
      "INSERT INTO workflow(workspace_id,name,created_by) VALUES($1,'Approval regression',$2) RETURNING id",
      [actor.workspaceId, actor.actorId],
    )
  ).rows[0].id;
  await client.query(
    "INSERT INTO workflow_version(workflow_id,version,definition,created_by) VALUES($1,1,'{}',$2)",
    [workflow, actor.actorId],
  );
  const fixture = async () => {
    const runId = (
      await client.query(
        "INSERT INTO workflow_run(workspace_id,workflow_id,workflow_version,status,idempotency_key,input,context_snapshot,requested_by) VALUES($1,$2,1,'waiting_approval',$3,'{}','{}',$4) RETURNING id",
        [actor.workspaceId, workflow, randomUUID(), actor.actorId],
      )
    ).rows[0].id;
    const plan = {
      summary: "Review exact draft",
      requiresApproval: true,
      actions: [
        {
          stepOrder: 1,
          type: "social.create_post",
          platform: "telegram",
          accountId: "fixture-only",
          content: "Never sent by this test",
          idempotencyKey: runId,
          requiresApproval: true,
        },
      ],
    };
    const approvalId = (
      await client.query(
        "INSERT INTO approval_request(workspace_id,run_id,requested_action) VALUES($1,$2,$3) RETURNING id",
        [actor.workspaceId, runId, plan],
      )
    ).rows[0].id;
    return { runId, approvalId };
  };
  for (const decision of ["approved", "rejected"] as const)
    await t.test(
      `real PostgreSQL ${decision} commits, replays once and rejects the opposite decision`,
      async () => {
        const { runId, approvalId } = await fixture();
        const decide = () =>
          database.withWorkspace(actor.workspaceId, (tx) =>
            decideApproval(
              tx,
              actor,
              approvalId,
              decision,
              "Verified immutable draft",
            ),
          );
        const results = await Promise.all([decide(), decide()]);
        assert.deepEqual(results[0], results[1]);
        assert.equal(
          (
            await client.query(
              "SELECT status,decision_reason FROM approval_request WHERE id=$1",
              [approvalId],
            )
          ).rows[0].status,
          decision,
        );
        assert.equal(
          (
            await client.query("SELECT status FROM workflow_run WHERE id=$1", [
              runId,
            ])
          ).rows[0].status,
          decision === "approved" ? "queued" : "cancelled",
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int AS n FROM job WHERE run_id=$1 AND kind='execute_approved_actions'",
              [runId],
            )
          ).rows[0].n,
          decision === "approved" ? 1 : 0,
        );
        await assert.rejects(
          database.withWorkspace(actor.workspaceId, (tx) =>
            decideApproval(
              tx,
              actor,
              approvalId,
              decision === "approved" ? "rejected" : "approved",
            ),
          ),
          /approval_already_decided/,
        );
        await assert.rejects(
          database.withWorkspace(randomUUID(), (tx) =>
            decideApproval(
              tx,
              { ...actor, workspaceId: randomUUID() },
              approvalId,
              decision,
            ),
          ),
          /approval_not_found/,
        );
      },
    );
  await t.test(
    "approval failure rolls back the decision and leaves no execution job",
    async () => {
      const { runId, approvalId } = await fixture();
      await client.query(
        "UPDATE workflow_run SET status='failed' WHERE id=$1",
        [runId],
      );
      await assert.rejects(
        database.withWorkspace(actor.workspaceId, (tx) =>
          decideApproval(tx, actor, approvalId, "approved"),
        ),
        /run_not_waiting_approval/,
      );
      assert.equal(
        (
          await client.query(
            "SELECT status FROM approval_request WHERE id=$1",
            [approvalId],
          )
        ).rows[0].status,
        "pending",
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM job WHERE run_id=$1",
            [runId],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await client.query(
    "INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status) VALUES($1,$2,'test.seed',0,29,'succeeded')",
    [actor.workspaceId, randomUUID()],
  );
  const tasks = new TaskService(database),
    choices = new ModelChoiceService(database);
  const task = await tasks.create(actor, {
    requestId: randomUUID(),
    goal: "Draft a welcome",
    modelBand: "flagship",
  });
  const reply = await tasks.message(actor, task.id, {
    requestId: randomUUID(),
    message: "Draft a welcome",
    modelBand: "flagship",
    expectedVersion: 0,
  });
  let calls = 0,
    actualBand = "",
    jobKind = "task.turn";
  let modelAction: "answer" | "search" = "answer";
  let classifications = 0;
  const nextJob = async () => {
    const result = await client.query(
      "UPDATE job SET status='running',attempt=attempt+1,locked_at=now(),locked_by='model-choice-test' WHERE id=(SELECT id FROM job WHERE workspace_id=$1 AND kind=$2 AND status='queued' AND available_at<=now() ORDER BY created_at LIMIT 1) RETURNING id,workspace_id AS \"workspaceId\",run_id AS \"runId\",kind,payload,attempt",
      [actor.workspaceId, jobKind],
    );
    return result.rows[0] as ClaimedJob | undefined;
  };
  const worker = new RunWorker({
    workerName: "model-choice-test",
    database: {
      withWorkspace: database.withWorkspace.bind(database),
      claimNextJob: nextJob,
    },
    aiRuntime: {
      async prepareAnnouncement() {
        throw new Error("unexpected");
      },
      async getAnnouncementRun() {
        throw new Error("unexpected");
      },
      async classifyItems(payload) {
        classifications++;
        actualBand = String(payload.modelBand);
        return {
          assignments: (
            payload.items as Array<{ index: number; text: string }>
          ).map((item) => ({
            itemIndex: item.index,
            sentiment: { label: "neutral", confidence: 1, evidence: item.text },
            tags: [],
          })),
        };
      },
      async generateInsightReport() {
        throw new Error("unexpected");
      },
      async taskStep(payload) {
        calls++;
        actualBand = String(payload.modelBand);
        return {
          action: modelAction,
          query: modelAction === "search" ? "guide" : "",
          markdown: modelAction === "search" ? "" : "Welcome!",
          citations: [],
        };
      },
    },
  });
  await t.test(
    "insufficient model credits wait without debit or model calls until explicit confirmation",
    async () => {
      await worker.runOne();
      assert.equal(calls, 0);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM task_event WHERE subject_id=$1",
            [reply.messageId],
          )
        ).rows[0].n,
        0,
      );
      const pending = await choices.list(actor);
      assert.equal(pending.length, 1);
      assert.equal(pending[0]!.requestedBand, "flagship");
      assert.deepEqual(pending[0]!.choices, ["eco"]);
      assert.equal(
        await worker.runOne(),
        false,
        "pending choice is not automatically reclaimed",
      );
      await assert.rejects(
        choices.choose(actor, pending[0]!.id, {
          modelBand: "standard",
          reason: "Explicit choice",
        }),
        /model_choice_unavailable/,
      );
      await assert.rejects(
        choices.choose({ ...actor, actorId: randomUUID() }, pending[0]!.id, {
          modelBand: "eco",
          reason: "Explicit choice",
        }),
        /workspace_membership_required/,
      );
      await choices.choose(actor, pending[0]!.id, {
        modelBand: "eco",
        reason: "User explicitly confirmed Eco",
      });
      await worker.runOne();
      assert.equal(calls, 1);
      assert.equal(actualBand, "eco");
      const detail = await tasks.detail(actor, task.id);
      assert.equal(detail.task.status, "completed");
      const charges = (
        await client.query(
          "SELECT model_band,ai_credits FROM task_event WHERE subject_id=$1",
          [reply.messageId],
        )
      ).rows;
      assert.equal(charges.length, 1);
      assert.equal(charges[0].model_band, "eco");
      assert.equal(Number(charges[0].ai_credits), 1);
      assert.equal(
        (detail.messages.at(-1) as { executions: Array<{ band: string }> })
          .executions[0]!.band,
        "eco",
      );
      assert.equal((await choices.list(actor)).length, 0);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM audit_event WHERE workspace_id=$1 AND event_type='ai.model_choice_confirmed' AND length(payload->>'reason')>=3",
            [actor.workspaceId],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "source classification also waits for explicit consent and resumes the same import",
    async () => {
      jobKind = "import.classify";
      await client.query(
        "UPDATE workspace_billing SET subscription_status='active',plan='creator' WHERE workspace_id=$1",
        [actor.workspaceId],
      );
      await client.query(
        "INSERT INTO task_event(workspace_id,subject_id,action_type,billable_units,ai_credits,status) VALUES($1,$2,'test.seed2',0,369,'succeeded')",
        [actor.workspaceId, randomUUID()],
      );
      const batch = await new ImportService(database).createImport(actor, {
        sourceType: "paste",
        label: "Import consent",
        content: "One source\nAnother source",
        modelBand: "standard",
      });
      await worker.runOne();
      assert.equal(classifications, 0);
      const waiting = await choices.list(actor);
      assert.equal(waiting[0]!.kind, "import.classify");
      await choices.choose(actor, waiting[0]!.id, {
        modelBand: "eco",
        reason: "Confirm Eco classification",
      });
      await worker.runOne();
      assert.equal(classifications, 1);
      assert.equal(actualBand, "eco");
      assert.equal(
        (
          await client.query("SELECT status FROM import_batch WHERE id=$1", [
            batch.id,
          ])
        ).rows[0].status,
        "classified",
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM task_event WHERE subject_id=$1",
            [batch.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "a mid-turn credit change preserves the paid step and records both actual bands",
    async () => {
      jobKind = "task.turn";
      modelAction = "search";
      await client.query(
        "UPDATE workspace_billing SET purchased_ai_credits=30 WHERE workspace_id=$1",
        [actor.workspaceId],
      );
      const next = await tasks.create(actor, {
        requestId: randomUUID(),
        goal: "Draft a welcome",
        modelBand: "flagship",
      });
      await tasks.message(actor, next.id, {
        requestId: randomUUID(),
        message: "Draft a welcome",
        modelBand: "flagship",
        expectedVersion: 0,
      });
      const before = calls;
      await worker.runOne();
      assert.equal(calls, before + 1);
      const waiting = await choices.list(actor);
      // The earlier 1-credit trial step no longer consumes the paid allowance.
      assert.equal(waiting[0]!.availableCredits, 11);
      assert.deepEqual(waiting[0]!.choices, ["eco", "standard"]);
      modelAction = "answer";
      await choices.choose(actor, waiting[0]!.id, {
        modelBand: "standard",
        reason: "Confirm Standard for the remaining steps",
      });
      await worker.runOne();
      assert.equal(calls, before + 2);
      assert.equal(actualBand, "standard");
      const detail = await tasks.detail(actor, next.id);
      const executions = (
        detail.messages.at(-1) as {
          executions: Array<{ band: string; credits: number }>;
        }
      ).executions;
      assert.deepEqual(
        executions.map((e) => e.band),
        ["flagship", "standard"],
      );
      assert.equal(
        executions.reduce((n, e) => n + Number(e.credits), 0),
        26,
      );
    },
  );
  await t.test(
    "sufficient credits preserve Flagship execution and charge its actual policy",
    async () => {
      await client.query(
        "UPDATE workspace_billing SET purchased_ai_credits=100 WHERE workspace_id=$1",
        [actor.workspaceId],
      );
      const next = await tasks.create(actor, {
        requestId: randomUUID(),
        goal: "Draft a welcome",
        modelBand: "flagship",
      });
      await tasks.message(actor, next.id, {
        requestId: randomUUID(),
        message: "Draft a welcome",
        modelBand: "flagship",
        expectedVersion: 0,
      });
      await worker.runOne();
      assert.equal(actualBand, "flagship");
      const detail = await tasks.detail(actor, next.id);
      const executions = (
        detail.messages.at(-1) as {
          executions: Array<{ band: string; credits: number }>;
        }
      ).executions;
      assert.equal(executions[0]!.band, "flagship");
      assert.equal(Number(executions[0]!.credits), 20);
    },
  );
}
