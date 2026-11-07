import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { Client } from "pg";
import type { Database } from "../src/foundation/database";
import { FeedbackService } from "../src/feedback-service/service";
import { editApproval } from "../src/run-service/approval-edit";
import { decideApproval } from "../src/run-service/repository";
export async function feedbackScheduleRegression(
  t: TestContext,
  client: Client,
  db: Database,
) {
  const oldMode = process.env.AI_METERING_MODE,
    oldRates = process.env.AI_METERING_RATES_JSON;
  process.env.AI_METERING_MODE = "cost-v1";
  const rate = {
    version: "feedback-test",
    model: "fixture",
    responseModels: ["fixture"],
    inputUsdPerMillion: "2",
    outputUsdPerMillion: "10",
    cacheUsdPerMillion: "0.2",
    source: "fixture",
    verifiedAt: new Date().toISOString(),
  };
  process.env.AI_METERING_RATES_JSON = JSON.stringify({
    eco: rate,
    standard: rate,
    flagship: rate,
  });
  try {
    const actor = {
      actorId: randomUUID(),
      workspaceId: randomUUID(),
      role: "owner" as const,
    };
    await client.query(
      "INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Feedback tester')",
      [actor.actorId, actor.actorId + "@example.invalid"],
    );
    await client.query(
      "INSERT INTO workspace(id,name,slug) VALUES($1,'Feedback test',$2)",
      [actor.workspaceId, actor.workspaceId],
    );
    await client.query(
      "INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner')",
      [actor.workspaceId, actor.actorId],
    );
    await client.query(
      "INSERT INTO workspace_billing(workspace_id,period_start,plan,subscription_status) VALUES($1,date_trunc('month',now())::date,'creator','active')",
      [actor.workspaceId],
    );
    const profile = randomUUID();
    await client.query(
      "INSERT INTO zernio_tenant(workspace_id,profile_id) VALUES($1,$2)",
      [actor.workspaceId, profile],
    );
    const account = (
      await client.query(
        "INSERT INTO connected_account(workspace_id,provider,external_account_id,display_name,platform,zernio_profile_id) VALUES($1,'zernio','remote','Feedback channel','youtube',$2) RETURNING id",
        [actor.workspaceId, profile],
      )
    ).rows[0].id as string;
    let providerCalls = 0;
    let bad = false;
    let truncated=false;
    const svc = new FeedbackService(db, {
      async readInboxPage(path) {
        providerCalls++;
        if (bad) throw new Error("unavailable");
        return new URL(path, "https://fixture.invalid").pathname.endsWith(
          "/post",
        )
          ? {
              comments: [
                {
                  id: truncated?"partial-comment":"comment",
                  message: "Please improve the onboarding tutorial.",
                  createdTime: new Date(Date.now() - 60000).toISOString(),
                },
              ],
              pagination: { hasMore: truncated,cursor:truncated?"repeat":undefined },
            }
          : {
              data: [{ id: "post", accountId: "remote" }],
              pagination: { hasMore: false },
            };
      },
    });
    const scanBody = {
      requestId: randomUUID(),
      accountIds: [account],
      range: "since",
      maxItems: 20,
    };
    await t.test(
      "concurrent submission is idempotent; read-only collection deduplicates without an AI job",
      async () => {
        const [a, b] = await Promise.all([
          svc.createScan(actor, scanBody),
          svc.createScan(actor, scanBody),
        ]);
        assert.equal(a.id, b.id);
        await svc.executeScan(actor.workspaceId, a.id);
        const result = await svc.scan(actor, a.id);
        assert.equal(result.status, "completed");
        assert.equal(result.itemCount, 1);
        const second = await svc.createScan(actor, {
          ...scanBody,
          requestId: randomUUID(),
        });
        await svc.executeScan(actor.workspaceId, second.id);
        assert.equal((await svc.scan(actor, second.id)).itemCount, 0);
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int AS n FROM ai_cost_operation WHERE workspace_id=$1",
              [actor.workspaceId],
            )
          ).rows[0].n,
          0,
        );
        await assert.rejects(
          svc.createScan({ ...actor, role: "viewer" }, scanBody),
        );
        await assert.rejects(
          svc.createScan(actor, {
            ...scanBody,
            requestId: randomUUID(),
            accountIds: [randomUUID()],
          }),
        );
      },
    );
    await t.test('partial evidence remains unavailable until explicit persisted acceptance',async()=>{
      truncated=true;const scan=await svc.createScan(actor,{...scanBody,requestId:randomUUID()});await svc.executeScan(actor.workspaceId,scan.id);truncated=false;
      const done=await svc.scan(actor,scan.id);assert.equal(done.status,'partial');assert.equal(done.itemCount,1);
      assert.equal((await client.query('SELECT status FROM import_batch WHERE id=$1',[done.batchId])).rows[0].status,'pending');
      await assert.rejects(svc.acceptScan(actor,scan.id,{confirmPartial:false}));await svc.acceptScan(actor,scan.id,{confirmPartial:true});
      assert.equal((await client.query('SELECT status FROM import_batch WHERE id=$1',[done.batchId])).rows[0].status,'classified');
      assert.ok((await client.query('SELECT analysis_accepted_at FROM feedback_scan WHERE id=$1',[scan.id])).rows[0].analysis_accepted_at);
    });
    const schedule = {
      name: "Daily feedback",
      goal: "Identify onboarding friction",
      accountIds: [account],
      modelBand: "eco",
      language: "en",
      localTime: "09:00",
      timezone: "Asia/Shanghai",
      dailyCredits: 20,
      maxItems: 100,
      enabled: true,
      consent: true,
    };
    let scheduleId = "";
    await t.test(
      "explicit schedule consent, due discovery, daily deduplication and independent source cursor",
      async () => {
        await assert.rejects(
          svc.saveSchedule(actor, undefined, { ...schedule, consent: false }),
        );
        scheduleId = (await svc.saveSchedule(actor, undefined, schedule)).id;
        await client.query(
          "UPDATE feedback_schedule SET next_run_at=now()-interval '1 minute' WHERE id=$1",
          [scheduleId],
        );
        assert.ok(
          (
            await client.query("SELECT * FROM due_feedback_workspaces()")
          ).rows.some((r) => r.workspace_id === actor.workspaceId),
        );
        await Promise.all([
          svc.enqueueDue(actor.workspaceId),
          svc.enqueueDue(actor.workspaceId),
        ]);
        const runs = await svc.history(actor, scheduleId);
        assert.equal(runs.length, 1);
        await svc.executeScan(actor.workspaceId, String(runs[0]!.id));
        const done = await svc.scan(actor, String(runs[0]!.id));
        assert.equal(
          done.itemCount,
          1,
          "manual scan must not consume this schedule evidence",
        );
        assert.ok(done.reportId);
        const op = (
          await client.query(
            "SELECT * FROM ai_cost_operation WHERE subject_id=$1",
            [done.reportId],
          )
        ).rows[0];
        assert.equal(op.max_credits, 20);
        assert.equal(op.band, "eco");
        assert.equal(op.max_calls, 1);
        assert.equal(
          (
            await client.query("SELECT goal FROM insight_report WHERE id=$1", [
              done.reportId,
            ])
          ).rows[0].goal,
          schedule.goal,
        );
        await assert.rejects(
          svc.pause(actor, scheduleId, { expectedVersion: 99 }),
        );
        await svc.pause(actor, scheduleId, { expectedVersion: 1 });
      },
    );
    await t.test(
      "partial scheduled collection pauses and creates no paid operation",
      async () => {
        const id = (
          await svc.saveSchedule(actor, undefined, {
            ...schedule,
            name: "Partial",
          })
        ).id;
        await client.query(
          "UPDATE feedback_schedule SET next_run_at=now()-interval '1 minute' WHERE id=$1",
          [id],
        );
        await svc.enqueueDue(actor.workspaceId);
        const run = (await svc.history(actor, id))[0]!;
        bad = true;
        await svc.executeScan(actor.workspaceId, String(run.id));
        bad = false;
        const done = await svc.scan(actor, String(run.id));
        assert.equal(done.reportId, null);
        assert.equal(done.analysisError, "feedback_partial_requires_review");
        assert.equal(
          (
            await client.query(
              "SELECT enabled FROM feedback_schedule WHERE id=$1",
              [id],
            )
          ).rows[0].enabled,
          false,
        );
      },
    );
    await t.test('insufficient budget pauses without an AI operation; empty collections skip the balance check',async()=>{
      const id=(await svc.saveSchedule(actor,undefined,{...schedule,name:'Budget stop',dailyCredits:10000})).id;
      await client.query("UPDATE feedback_schedule SET next_run_at=now()-interval '1 minute' WHERE id=$1",[id]);await svc.enqueueDue(actor.workspaceId);const scan=(await svc.history(actor,id))[0]!;
      await svc.executeScan(actor.workspaceId,String(scan.id));const result=await svc.scan(actor,String(scan.id));assert.equal(result.analysisError,'ai_budget_insufficient');assert.equal(result.reportId,null);
      const empty=new FeedbackService(db,{readInboxPage:async()=>({data:[],pagination:{hasMore:false}})});
      const emptyId=(await empty.saveSchedule(actor,undefined,{...schedule,name:'Empty',dailyCredits:10000})).id;
      await client.query("UPDATE feedback_schedule SET next_run_at=now()-interval '1 minute' WHERE id=$1",[emptyId]);await empty.enqueueDue(actor.workspaceId);const emptyScan=(await empty.history(actor,emptyId))[0]!;await empty.executeScan(actor.workspaceId,String(emptyScan.id));
      const done=await empty.scan(actor,String(emptyScan.id));assert.equal(done.itemCount,0);assert.equal(done.analysisError,null);assert.equal(done.reportId,null);assert.equal((await client.query('SELECT enabled FROM feedback_schedule WHERE id=$1',[emptyId])).rows[0].enabled,true);
    });
    await t.test(
      "saved edits require the new version and delivery uses exactly that snapshot",
      async () => {
        const reportId = (
          await client.query(
            "INSERT INTO insight_report(workspace_id,template,title,model_band,batch_ids,created_by) VALUES($1,'daily_ops','Delivery','eco','[]',$2) RETURNING id",
            [actor.workspaceId, actor.actorId],
          )
        ).rows[0].id;
        const action = {
          actionType: "insight.deliver_report",
          parameters: {
            reportId,
            channel: "email",
            subject: "Old subject",
            content: "Old body",
          },
        };
        const id = (
          await client.query(
            "INSERT INTO approval_request(workspace_id,insight_report_id,requested_action) VALUES($1,$2,$3) RETURNING id",
            [actor.workspaceId, reportId, action],
          )
        ).rows[0].id;
        await client.query(
          "UPDATE insight_report SET delivery=$2 WHERE id=$1",
          [
            reportId,
            {
              approvalId: id,
              status: "pending_approval",
              channel: "email",
              subject: "Old subject",
              content: "Old body",
            },
          ],
        );
        const edited = await db.withWorkspace(actor.workspaceId, (tx) =>
          editApproval(tx, actor, id, {
            expectedVersion: 1,
            subject: "Reviewed subject",
            content: "Reviewed body",
          }),
        );
        assert.equal(edited.version, 2);
        await assert.rejects(
          db.withWorkspace(actor.workspaceId, (tx) =>
            decideApproval(tx, actor, id, "approved", undefined, 1),
          ),
        );
        await db.withWorkspace(actor.workspaceId, (tx) =>
          decideApproval(tx, actor, id, "approved", undefined, 2),
        );
        const delivery = (
          await client.query(
            "SELECT delivery FROM insight_report WHERE id=$1",
            [reportId],
          )
        ).rows[0].delivery;
        assert.equal(delivery.content, "Reviewed body");
        assert.equal(delivery.subject, "Reviewed subject");
        assert.equal(delivery.approvedVersion, 2);
        await assert.rejects(
          db.withWorkspace(actor.workspaceId, (tx) =>
            editApproval(tx, actor, id, {
              expectedVersion: 2,
              subject: "Late",
              content: "Late",
            }),
          ),
        );
        assert.equal(
          (
            await client.query(
              "SELECT requested_action FROM approval_content_version WHERE approval_id=$1",
              [id],
            )
          ).rows[0].requested_action.parameters.content,
          "Old body",
        );
      },
    );
    await t.test('new tenant tables enforce RLS under a non-bypass database role',async()=>{
      const role='feedback_test_'+randomUUID().replaceAll('-','');await client.query('BEGIN');
      try{await client.query(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);await client.query(`GRANT SELECT ON feedback_schedule,feedback_scan,feedback_source_state,feedback_comment,approval_content_version TO ${role}`);await client.query(`SET LOCAL ROLE ${role}`);
       await client.query("SELECT set_config('app.workspace_id',$1,true)",[actor.workspaceId]);assert.ok((await client.query('SELECT id FROM feedback_schedule')).rowCount!>0);
       await client.query("SELECT set_config('app.workspace_id',$1,true)",[randomUUID()]);for(const table of ['feedback_schedule','feedback_scan','feedback_source_state','feedback_comment','approval_content_version'])assert.equal((await client.query(`SELECT * FROM ${table}`)).rowCount,0);
      }finally{await client.query('ROLLBACK')}
    });
    assert.ok(providerCalls > 0);
    const security = await client.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('feedback_schedule','feedback_scan','feedback_source_state','feedback_comment','approval_content_version')",
    );
    assert.equal(security.rows.length, 5);
    assert.ok(
      security.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
    );
  } finally {
    if (oldMode === undefined) delete process.env.AI_METERING_MODE;
    else process.env.AI_METERING_MODE = oldMode;
    if (oldRates === undefined) delete process.env.AI_METERING_RATES_JSON;
    else process.env.AI_METERING_RATES_JSON = oldRates;
  }
}
