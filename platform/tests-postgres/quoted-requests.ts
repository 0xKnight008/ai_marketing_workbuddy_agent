import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { Client } from 'pg';
import { quoteCost } from '../src/billing/cost-metering';
import { usageSnapshot } from '../src/billing/guardrails';
import type { Database } from '../src/foundation/database';
import { ImportService } from '../src/import-service/service';
import { InsightService } from '../src/insight-service/service';
import { TopicService } from '../src/insight-service/topics';
import { TaskService } from '../src/task-service/service';

/** Exercise the public request shapes against real services and tenant transactions. */
export async function quotedRequestRegression(t: TestContext, client: Client, db: Database) {
  const originalMode = process.env.AI_METERING_MODE;
  const originalRates = process.env.AI_METERING_RATES_JSON;
  const rate = { version: 'request-fixture', model: 'fixture', responseModels: ['fixture'], inputUsdPerMillion: '2', outputUsdPerMillion: '10', cacheUsdPerMillion: '0.2', source: 'test fixture only', verifiedAt: '2026-10-26T00:00:00Z' };
  process.env.AI_METERING_RATES_JSON = JSON.stringify({ eco: rate, standard: rate, flagship: rate });
  try {
    for (const mode of ['shadow', 'cost-v1'] as const) {
      for (const modelBand of ['eco', 'standard', 'flagship'] as const) {
        await t.test(`${mode}/${modelBand}: quoted import, report, topics and task turn persist; refreshed import quotes remain idempotent`, async () => {
          process.env.AI_METERING_MODE = mode;
          const actor = { actorId: randomUUID(), workspaceId: randomUUID(), role: 'owner' as const };
          await client.query("INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Quoted request tester')", [actor.actorId, actor.actorId + '@example.invalid']);
          await client.query("INSERT INTO workspace(id,name,slug) VALUES($1,'Quoted request fixture',$2)", [actor.workspaceId, actor.workspaceId]);
          await client.query("INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES($1,$2,'owner')", [actor.workspaceId, actor.actorId]);
          await client.query("INSERT INTO workspace_billing(workspace_id,period_start,plan,subscription_status) VALUES($1,date_trunc('month',now())::date,'creator','active')", [actor.workspaceId]);
          const quote = async (kind: string, selectedBand = modelBand, owner = actor) => {
            const q = await quoteCost(db, owner, { kind, modelBand: selectedBand, maxCredits: 30 });
            assert.ok('quoteId' in q);
            return q.quoteId;
          };
          const imports = new ImportService(db);
          const tasks = new TaskService(db);
          const task = await tasks.create(actor, { requestId: randomUUID(), goal: 'Summarize the source comments', modelBand, language: 'en' });
          const before = await db.withWorkspace(actor.workspaceId, usageSnapshot);
          const firstQuote = await quote('import.classify');
          const importBody = { taskId: task.id, label: 'Quoted comments', sourceType: 'paste', content: 'Where is the guide?\nPlease add an example.', deduplicate: true, modelBand };
          const batch = await imports.createImport(actor, { ...importBody, aiQuoteId: firstQuote });
          const refreshedQuote = await quote('import.classify');
          const retry = await imports.createImport(actor, { ...importBody, aiQuoteId: refreshedQuote });
          assert.equal(retry.id, batch.id);
          const csvQuote = await quote('import.classify');
          const csv = await imports.createImport(actor, { label: 'Quoted CSV', sourceType: 'csv', content: 'text\nA CSV comment', modelBand, aiQuoteId: csvQuote });
          assert.notEqual(csv.id, batch.id);
          await db.withWorkspace(actor.workspaceId, async tx => {
            await tx.query("UPDATE import_batch SET status='classified',classified_at=now() WHERE id=$1", [batch.id]);
            await tx.query('UPDATE import_item SET classified_at=now() WHERE batch_id=$1', [batch.id]);
          });
          const reportQuote = await quote('insight.generate');
          const report = await new InsightService(db).createInsight(actor, { template: 'comment_insights', batchIds: [batch.id], modelBand, aiQuoteId: reportQuote });
          const topicsQuote = await quote('topics.cluster');
          const topics = await new TopicService(db).startTopicRun(actor, { modelBand, aiQuoteId: topicsQuote });
          const detail = await tasks.detail(actor, task.id);
          const turnQuote = await quote('task.turn');
          const turn = await tasks.message(actor, task.id, { requestId: randomUUID(), message: 'Summarize the source comments', expectedVersion: detail.task.version, modelBand, aiQuoteId: turnQuote });
          await db.withWorkspace(actor.workspaceId, async tx => {
            const operations = await tx.query<{ id: string; mode: string; band: string; subject_id: string; state: string }>('SELECT id,mode,band,subject_id,state FROM ai_cost_operation ORDER BY created_at');
            for (const [id, subject] of [[firstQuote, batch.id], [csvQuote, csv.id], [reportQuote, report.id], [topicsQuote, topics.id], [turnQuote, turn.messageId]]) {
              const op = operations.rows.find(row => row.id === id);
              assert.deepEqual(op, { id, mode, band: modelBand, subject_id: subject, state: 'accepted' });
            }
            assert.equal(operations.rows.find(row => row.id === refreshedQuote)?.state, 'quoted');
            assert.equal((await tx.query("SELECT id FROM job WHERE kind='import.classify' AND payload->>'batchId'=$1", [batch.id])).rowCount, 1);
          });
          assert.equal((await db.withWorkspace(actor.workspaceId, usageSnapshot)).aiCreditsAvailable, before.aiCreditsAvailable, 'submission must not settle credits before worker execution');

          const countImports = () => db.withWorkspace(actor.workspaceId, async tx => Number((await tx.query<{ count: string }>('SELECT count(*)::text AS count FROM import_batch')).rows[0]!.count));
          const count = await countImports();
          const basic = { label: 'Rejected request', sourceType: 'paste', content: 'An example', modelBand };
          const wrongKind = await quote('task.turn');
          const otherActor = await quote('import.classify', modelBand, { ...actor, actorId: randomUUID() });
          const wrongBand = await quote('import.classify', modelBand === 'eco' ? 'standard' : 'eco');
          const expired = await quote('import.classify');
          await db.withWorkspace(actor.workspaceId, tx => tx.query("UPDATE ai_cost_operation SET expires_at=now()-interval '1 minute' WHERE id=$1", [expired]));
          for (const aiQuoteId of [wrongKind, otherActor, wrongBand, expired]) {
            await assert.rejects(imports.createImport(actor, { ...basic, aiQuoteId }), error => (error as { code?: string }).code === 'ai_quote_expired_or_mismatched');
          }
          for (const body of [{ ...basic, aiQuoteId: 'invalid' }, { ...basic, aiQuoteId: firstQuote, unrelatedField: true }, basic]) {
            await assert.rejects(imports.createImport(actor, body));
          }
          assert.equal(await countImports(), count, 'invalid quote authorization must roll back the batch');
        });
      }
    }
  } finally {
    if (originalMode === undefined) delete process.env.AI_METERING_MODE; else process.env.AI_METERING_MODE = originalMode;
    if (originalRates === undefined) delete process.env.AI_METERING_RATES_JSON; else process.env.AI_METERING_RATES_JSON = originalRates;
  }
}
