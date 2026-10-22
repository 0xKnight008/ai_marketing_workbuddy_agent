import {AdminService} from "../src/admin/service";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client } from "pg";
import { Database } from "../src/foundation/database";
import { TaskService } from "../src/task-service/service";
import { ImportService } from "../src/import-service/service";
import { RunWorker, type ClaimedJob } from "../src/run-service/worker-runner";
import { PlatformService } from "../src/egg/platform-service";
import type { ActorContext } from "../src/contracts/domain";
import type { GatewayConfig } from "../src/foundation/platform-config";
import type { PlatformOrm } from "../src/foundation/sequelize";

export async function taskContextRegression(
  t: TestContext,
  client: Client,
  database: Database,
) {
  const owner: ActorContext = {
      actorId: randomUUID(),
      workspaceId: randomUUID(),
      role: "owner",
    },
    other: ActorContext = {
      actorId: randomUUID(),
      workspaceId: randomUUID(),
      role: "owner",
    };
  for (const actor of [owner, other]) {
    await client.query(
      "INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Task tester')",
      [actor.actorId, `task-${actor.actorId}@example.invalid`],
    );
    await client.query(
      "INSERT INTO workspace(id,name,slug) VALUES($1,'Task test',$2)",
      [actor.workspaceId, `task-${actor.workspaceId}`],
    );
    await client.query(
      "INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner')",
      [actor.workspaceId, actor.actorId],
    );
    await client.query(
      "INSERT INTO workspace_billing(workspace_id,plan,subscription_status) VALUES($1,'agency','active')",
      [actor.workspaceId],
    );
  }
  const deviceA = new TaskService(database),
    deviceB = new TaskService(database);
  const base = {
    goal: "Find the onboarding friction and draft a helpful reply",
    persona: "creators",
    modelBand: "eco",
    language: "en",
  };
  const task = await deviceA.create(owner, {
    ...base,
    requestId: randomUUID(),
  });
  const imports = new ImportService(database);
  let batchId = "";
  let itemId = "";
  await t.test(
    "task import is atomic and idempotent, with immutable input binding",
    async () => {
      const input = {
        taskId: task.id,
        label: "Selected comments",
        sourceType: "paste",
        content: "Where can I find the guide?\nThe guide needs clearer steps.",
        modelBand: "eco",
        deduplicate: true,
      };
      const results = await Promise.all([
        imports.createImport(owner, input),
        imports.createImport(owner, input),
      ]);
      assert.equal(results[0]!.id, results[1]!.id);
      batchId = results[0]!.id;
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM job WHERE workspace_id=$1 AND kind='import.classify' AND payload->>'batchId'=$2",
            [owner.workspaceId, batchId],
          )
        ).rows[0].count,
        "1",
      );
      await assert.rejects(
        imports.createImport(owner, { ...input, content: "Different content" }),
        /task_import_already_attached/,
      );
      assert.deepEqual((await deviceB.detail(owner, task.id)).task.batchIds, [
        batchId,
      ]);
      await client.query(
        "UPDATE import_batch SET status='classified' WHERE id=$1",
        [batchId],
      );
      await client.query(
        "UPDATE import_item SET classified_at=now() WHERE batch_id=$1",
        [batchId],
      );
      await client.query(
        "UPDATE job SET status='succeeded' WHERE payload->>'batchId'=$1",
        [batchId],
      );
      itemId = (
        await client.query(
          "SELECT id FROM import_item WHERE batch_id=$1 ORDER BY created_at,id LIMIT 1",
          [batchId],
        )
      ).rows[0].id;
    },
  );
  await t.test(
    "preferences survive a second service instance and stay scoped to membership",
    async () => {
      const preferences = {
        persona: "sellers",
        modelBand: "flagship",
        language: "zh",
        goal: "分析退货原因",
      };
      await deviceA.preferences(owner, preferences);
      assert.deepEqual(await deviceB.preferences(owner), preferences);
      assert.notDeepEqual(await deviceB.preferences(other), preferences);
      await assert.rejects(
        deviceA.preferences({ ...owner, actorId: other.actorId }, preferences),
        /workspace_membership_required/,
      );
    },
  );
  let responseId = "",
    version = 0;
  let activeTaskId = task.id;
  const nextJob = async (): Promise<ClaimedJob | undefined> =>
    database.withWorkspace(owner.workspaceId, async (tx) => {
      const r = await tx.query<ClaimedJob>(
        `UPDATE job SET status='running',attempt=attempt+1,locked_at=now(),locked_by='task-regression' WHERE id=(SELECT id FROM job WHERE workspace_id=$1 AND kind='task.turn' AND status='queued' AND payload->>'taskId'=$2 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,workspace_id AS "workspaceId",run_id AS "runId",kind,payload,attempt`,
        [owner.workspaceId, activeTaskId],
      );
      return r.rows[0];
    });
  let calls = 0;
  const runtime = {
    prepareAnnouncement: async () => {
      throw new Error("not expected");
    },
    getAnnouncementRun: async () => {
      throw new Error("not expected");
    },
    classifyItems: async () => ({ assignments: [] }),
    generateInsightReport: async () => ({}),
    taskStep: async (payload: Record<string, unknown>) => {
      calls++;
      const sources = payload.sources as Array<{ ref: string; text: string }>;
      if (calls === 1)
        return {
          action: "search",
          query: "guide",
          markdown: "",
          citations: [],
        };
      if (calls === 2)
        return {
          action: "ask",
          query: "",
          markdown: "Should the reply focus on new members?",
          citations: [],
        };
      assert.ok(
        (payload.history as Array<{ content: string }>).some((m) =>
          m.content.includes("new members"),
        ),
      );
      return {
        action: "answer",
        query: "",
        markdown: "## Reply draft\n\nWelcome! Here is the guide.",
        citations: [
          {
            ref: itemId,
            snippet: sources.find((s) => s.ref === itemId)!.text.slice(0, 10),
          },
        ],
      };
    },
  };
  const worker = new RunWorker({
    workerName: "task-regression",
    database: {
      withWorkspace: (id, fn) => database.withWorkspace(id, fn),
      claimNextJob: nextJob,
    },
    aiRuntime: runtime,
  });
  await t.test(
    "concurrent turns are serialized and request replay does not duplicate jobs",
    async () => {
      const current = await deviceA.detail(owner, task.id);
      const request = {
        message: base.goal,
        modelBand: "eco",
        expectedVersion: current.task.version,
        requestId: randomUUID(),
      };
      const [first, replay] = await Promise.all([
        deviceA.message(owner, task.id, request),
        deviceB.message(owner, task.id, request),
      ]);
      assert.deepEqual(first, replay);
      responseId = first.messageId;
      version = first.version;
      assert.deepEqual(await deviceB.message(owner, task.id, request), first);
      await assert.rejects(
        deviceB.message(owner, task.id, {
          ...request,
          requestId: randomUUID(),
        }),
        /task_version_conflict|task_turn_in_progress/,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM job WHERE kind='task.turn' AND payload->>'messageId'=$1",
            [responseId],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "real worker persists search and clarification then uses saved history for a new goal",
    async () => {
      assert.equal(await worker.runOne(), true);
      const first = await deviceB.detail(owner, task.id);
      assert.equal(first.task.status, "ready");
      assert.equal(first.messages.length, 2);
      assert.equal(first.messages[0]!.role, "user");
      assert.match(String(first.messages[1]!.content), /new members/);
      const follow = await deviceB.message(owner, task.id, {
        message: "Yes, focus on new members and write an English reply.",
        modelBand: "eco",
        expectedVersion: first.task.version,
        requestId: randomUUID(),
      });
      responseId = follow.messageId;
      await worker.runOne();
      const final = await deviceA.detail(owner, task.id);
      assert.equal(final.task.status, "completed");
      assert.equal(final.messages.length, 4);
      assert.match(String(final.messages[3]!.content), /Reply draft/);
      assert.equal(calls, 3);
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM task_event WHERE workspace_id=$1 AND action_type='ai.task'",
            [owner.workspaceId],
          )
        ).rows[0].count,
        "3",
      );
      assert.match(
        String((await deviceA.evidence(owner, task.id, itemId)).text),
        /guide/,
      );
      await assert.rejects(
        deviceA.evidence(other, task.id, itemId),
        /task_not_found/,
      );
      const review = await deviceA.saveReview(owner, task.id, {
        messageId: responseId,
        refs: [itemId],
      });
      assert.equal(review.checkedBy, owner.actorId);
      const reread = await deviceB.detail(owner, task.id);
      assert.deepEqual(
        (reread.task as unknown as { review: unknown }).review,
        review,
      );
      await assert.rejects(
        deviceA.saveReview(owner, task.id, {
          messageId: responseId,
          refs: [randomUUID()],
        }),
        /task_review_invalid_evidence/,
      );
    },
  );
  await t.test(
    "support binds the task and a snapshot and rejects cross-workspace references",
    async () => {
      const service = new PlatformService(
        {} as GatewayConfig,
        database,
        {} as PlatformOrm,
      );
      const support = await service.createFeedback(owner, {
        message: "Please help with this task",
        category: "bug",
        taskId: task.id,
        locale: "en",
      });
      const saved = await client.query(
        "SELECT task_id,task_context FROM feedback_message WHERE ticket_no=$1",
        [support.ticketId],
      );
      assert.equal(saved.rows[0].task_id, task.id);
      assert.equal(saved.rows[0].task_context.goal, base.goal);
      await assert.rejects(
        service.createFeedback(other, {
          message: "Foreign task",
          taskId: task.id,
        }),
        /task_not_found/,
      );
    },
  );
  await t.test(
    "removal persists across devices and retains sources, messages, credits and reasons",
    async () => {
      await assert.rejects(
        deviceA.archive(owner, task.id, {
          archived: true,
          reason: "No longer needed",
        }),
        /only_failed_tasks_can_be_removed/,
      );
      await client.query(
        "UPDATE workspace_task SET status='failed' WHERE id=$1",
        [task.id],
      );
      const before = (
        await client.query(
          "SELECT count(*) FROM workspace_task_message WHERE task_id=$1",
          [task.id],
        )
      ).rows[0].count;
      await deviceA.archive(owner, task.id, {
        archived: true,
        reason: "The completed attempt was reported as failed",
      });
      assert.ok(!(await deviceB.list(owner, {})).some((r) => r.id === task.id));
      assert.ok(
        (await deviceB.list(owner, { archived: "1" })).some(
          (r) => r.id === task.id,
        ),
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM workspace_task_message WHERE task_id=$1",
            [task.id],
          )
        ).rows[0].count,
        before,
      );
      assert.equal(
        (
          await client.query(
            "SELECT payload->>'reason' AS reason FROM audit_event WHERE event_type='task.removed' AND workspace_id=$1",
            [owner.workspaceId],
          )
        ).rows[0].reason,
        "The completed attempt was reported as failed",
      );
      await deviceB.archive(owner, task.id, {
        archived: false,
        reason: "Resume manual follow-up",
      });
      assert.ok((await deviceA.list(owner, {})).some((r) => r.id === task.id));
      await client.query(
        "UPDATE workspace_membership SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [owner.workspaceId, owner.actorId],
      );
      await assert.rejects(
        deviceA.message(owner, task.id, {
          message: "New task",
          requestId: randomUUID(),
          modelBand: "eco",
          expectedVersion: version,
        }),
        /Forbidden/,
      );
      await client.query(
        "UPDATE workspace_membership SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
        [owner.workspaceId, owner.actorId],
      );
    },
  );
  await t.test(
    "legacy failed imports receive canonical task IDs with persistent removal",
    async () => {
      const batch = await imports.createImport(owner, {
        label: "Legacy failure",
        sourceType: "paste",
        content: "Failed source",
      });
      await client.query(
        "UPDATE import_batch SET status='failed' WHERE id=$1",
        [batch.id],
      );
      await client.query(
        "UPDATE job SET status='dead_lettered' WHERE payload->>'batchId'=$1",
        [batch.id],
      );
      const wrapper = (await deviceA.list(owner, {})).find(
        (r) => r.sourceId === batch.id,
      )!;
      assert.ok(wrapper);
      await deviceA.archive(owner, wrapper.id, {
        archived: true,
        reason: "Remove old failed import",
      });
      assert.ok(
        !(await deviceB.list(owner, {})).some((r) => r.sourceId === batch.id),
      );
    },
  );
  await t.test(
    "bounded search resumes after four steps without a fifth charge",
    async () => {
      const extra = await deviceA.create(owner, {
        ...base,
        batchIds: [batchId],
        requestId: randomUUID(),
      });
      activeTaskId = extra.id;
      await deviceA.message(owner, extra.id, {
        message: "Search for the guide",
        modelBand: "eco",
        expectedVersion: 0,
        requestId: randomUUID(),
      });
      let steps = 0;
      const bounded = new RunWorker({
        workerName: "task-regression",
        database: {
          withWorkspace: (id, fn) => database.withWorkspace(id, fn),
          claimNextJob: nextJob,
        },
        aiRuntime: {
          ...runtime,
          taskStep: async () => {
            steps++;
            return {
              action: "search",
              query: "guide",
              markdown: "",
              citations: [],
            };
          },
        },
      });
      await bounded.runOne();
      await bounded.runOne();
      assert.equal(steps, 4);
      assert.equal(
        (await deviceB.detail(owner, extra.id)).task.status,
        "ready",
      );
      const message = (
        await client.query(
          "SELECT id FROM workspace_task_message WHERE task_id=$1 AND role='assistant'",
          [extra.id],
        )
      ).rows[0].id;
      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM task_event WHERE subject_id=$1 AND action_type='ai.task'",
            [message],
          )
        ).rows[0].count,
        "4",
      );
    },
  );
  await t.test(
    "unknown citations never become saved evidence and terminal failure is removable",
    async () => {
      const extra = await deviceA.create(owner, {
        ...base,
        batchIds: [batchId],
        requestId: randomUUID(),
      });
      activeTaskId = extra.id;
      const queued = await deviceA.message(owner, extra.id, {
        message: "Give me a grounded answer",
        modelBand: "eco",
        expectedVersion: 0,
        requestId: randomUUID(),
      });
      await client.query(
        "UPDATE job SET max_attempts=1 WHERE kind='task.turn' AND payload->>'taskId'=$1",
        [extra.id],
      );
      const invalid = new RunWorker({
        workerName: "task-regression",
        database: {
          withWorkspace: (id, fn) => database.withWorkspace(id, fn),
          claimNextJob: nextJob,
        },
        aiRuntime: {
          ...runtime,
          taskStep: async () => ({
            action: "answer",
            query: "",
            markdown: "Unverified claim",
            citations: [{ ref: randomUUID(), snippet: "invented" }],
          }),
        },
      });
      await invalid.runOne();
      const failed = await deviceB.detail(owner, extra.id);
      assert.equal(failed.task.status, "failed");
      assert.equal(failed.messages[1]!.status, "failed");
      assert.equal(failed.messages[1]!.content, "");
      await deviceA.archive(owner, extra.id, {
        archived: true,
        reason: "Unverified output was rejected",
      });
      await new AdminService({BILLING_ADMIN_TOKEN:'test-replay-secret'} as GatewayConfig,database).replayJob(owner,'test-replay-secret',(await client.query("SELECT id FROM job WHERE kind='task.turn' AND payload->>'taskId'=$1",[extra.id])).rows[0].id,{workspaceId:owner.workspaceId,reason:'Try replay while removed'});
      const protectedReplay=new RunWorker({workerName:'task-regression',database:{withWorkspace:(id,fn)=>database.withWorkspace(id,fn),claimNextJob:nextJob},aiRuntime:{...runtime,taskStep:async()=>{throw new Error('archived task must never call the model')}}});await protectedReplay.runOne();assert.equal((await client.query("SELECT last_error FROM job WHERE kind='task.turn' AND payload->>'taskId'=$1",[extra.id])).rows[0].last_error,'task_archived_restore_before_replay');

      assert.equal(
        (
          await client.query(
            "SELECT count(*) FROM task_event WHERE subject_id=$1 AND action_type='ai.task'",
            [queued.messageId],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "paused billing defers before model execution, and an active job blocks removal",
    async () => {
      const extra = await deviceA.create(owner, {
        ...base,
        batchIds: [batchId],
        requestId: randomUUID(),
      });
      activeTaskId = extra.id;
      await deviceA.message(owner, extra.id, {
        message: "Continue after billing resumes",
        modelBand: "eco",
        expectedVersion: 0,
        requestId: randomUUID(),
      });
      await client.query(
        "UPDATE workspace_billing SET subscription_status='canceled' WHERE workspace_id=$1",
        [owner.workspaceId],
      );
      let invoked = false;
      const paused = new RunWorker({
        workerName: "task-regression",
        database: {
          withWorkspace: (id, fn) => database.withWorkspace(id, fn),
          claimNextJob: nextJob,
        },
        aiRuntime: {
          ...runtime,
          taskStep: async () => {
            invoked = true;
            return {};
          },
        },
      });
      await paused.runOne();
      assert.equal(invoked, false);
      assert.equal(
        (
          await client.query(
            "SELECT last_error FROM job WHERE kind='task.turn' AND payload->>'taskId'=$1",
            [extra.id],
          )
        ).rows[0].last_error,
        "ai_credits_deferred",
      );
      await client.query(
        "UPDATE workspace_task SET status='failed' WHERE id=$1",
        [extra.id],
      );
      await assert.rejects(
        deviceA.archive(owner, extra.id, {
          archived: true,
          reason: "Cannot hide an active job",
        }),
        /task_job_still_active/,
      );
      await client.query(
        "UPDATE workspace_billing SET subscription_status='active' WHERE workspace_id=$1",
        [owner.workspaceId],
      );
    },
  );
  await t.test('report continuation inherits selected sources and an immutable parent link',async()=>{
    const report=(await client.query("INSERT INTO insight_report(workspace_id,template,title,status,model_band,batch_ids,item_count,created_by,report) VALUES($1,'review_attribution','Saved seller report','generated','eco',$2,2,$3,$4) RETURNING id",[owner.workspaceId,JSON.stringify([batchId]),owner.actorId,{summary:'The guide is hard to find.',_language:'en'}])).rows[0].id;
    const parent=(await deviceA.list(owner,{})).find(row=>row.sourceId===report)!;assert.equal(parent.persona,'sellers');const input={...base,parentTaskId:parent.id,requestId:randomUUID()};const child=await deviceA.create(owner,input);assert.equal(child.parentTaskId,parent.id);assert.deepEqual(child.batchIds,[batchId]);await assert.rejects(deviceB.create(owner,{...input,goal:'Changed intent on the same request'}),/task_request_conflict/);await assert.rejects(deviceA.create(other,{...base,parentTaskId:parent.id,requestId:randomUUID()}),/task_not_found/);
    const reply=await deviceA.message(owner,child.id,{message:'Explain the previous report',requestId:randomUUID(),expectedVersion:0,modelBand:'eco'});activeTaskId=child.id;const continuation=new RunWorker({workerName:'task-regression',database:{withWorkspace:(id,fn)=>database.withWorkspace(id,fn),claimNextJob:nextJob},aiRuntime:{...runtime,taskStep:async payload=>{assert.equal(payload.priorResult,'The guide is hard to find.');return {action:'answer',query:'',markdown:'A follow-up grounded in the same sources.',citations:[]}}}});await continuation.runOne();assert.equal((await deviceB.detail(owner,child.id)).task.status,'completed');assert.ok(reply.messageId);
  });
  await t.test('credit recovery wakes the existing task job without creating a new turn',async()=>{
    const extra=await deviceA.create(owner,{...base,batchIds:[batchId],requestId:randomUUID()});await deviceA.message(owner,extra.id,{message:'Wait for credits',requestId:randomUUID(),expectedVersion:0,modelBand:'eco'});await client.query("UPDATE job SET available_at=now()+interval '6 hours',last_error='ai_credits_deferred' WHERE kind='task.turn' AND payload->>'taskId'=$1",[extra.id]);assert.equal((await deviceA.detail(owner,extra.id)).task.waitingReason,'ai_credits_deferred');const resumed=await deviceB.resume(owner,extra.id,{reason:'Available credits restored by the owner'});assert.equal(resumed.resumedJobs,1);assert.equal((await client.query("SELECT count(*) FROM job WHERE kind='task.turn' AND payload->>'taskId'=$1 AND available_at<=now()",[extra.id])).rows[0].count,'1');
  });
  await t.test(
    "new tables enforce RLS with a real non-superuser role",
    async () => {
      const rlsRole = "task_rls_" + randomUUID().replaceAll("-", "");
      await client.query(`CREATE ROLE ${rlsRole} NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${rlsRole}`);
      await client.query(
        `GRANT SELECT ON workspace_task,workspace_task_message,workspace_task_preference TO ${rlsRole}`,
      );
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.workspace_id',$1,true)", [
          other.workspaceId,
        ]);
        await client.query(`SET LOCAL ROLE ${rlsRole}`);
        assert.equal(
          (
            await client.query(
              "SELECT count(*) FROM workspace_task WHERE id=$1",
              [task.id],
            )
          ).rows[0].count,
          "0",
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*) FROM workspace_task_message WHERE task_id=$1",
              [task.id],
            )
          ).rows[0].count,
          "0",
        );
        assert.equal(
          (
            await client.query(
              "SELECT count(*) FROM workspace_task_preference WHERE user_id=$1",
              [owner.actorId],
            )
          ).rows[0].count,
          "0",
        );
      } finally {
        await client.query("ROLLBACK");
      }
    },
  );
}
