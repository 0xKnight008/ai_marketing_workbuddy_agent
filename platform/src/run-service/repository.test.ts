import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';

import type { AiRuntimeEvent } from '../contracts/ai-runtime-event';
import type { TenantTransaction } from '../foundation/database';
import { ingestAiRuntimeEvent } from './repository';

test('compliance-blocked action plans fail the run without creating an approval or execution job', async () => {
  const statements: string[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, _values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.startsWith('SELECT id, status FROM workflow_run')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111', status: 'running' }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO run_event')) return { rows: [{ id: 'event-1' }] as unknown as Row[], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const event: AiRuntimeEvent = {
    eventId: 'evt-compliance-blocked',
    platformRunId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    aiRunId: 'ai-run-1',
    type: 'action_plan.created',
    createdAt: '2026-08-10T00:00:00.000Z',
    payload: {
      actionPlan: {
        summary: 'Compliance blocker detected',
        requiresApproval: true,
        blockedByCompliance: true,
        actions: [{
          stepOrder: 1,
          type: 'social.create_post',
          platform: 'telegram',
          accountId: 'account-1',
          content: 'forbidden content',
          hashtags: [],
          mode: 'publish_now',
          idempotencyKey: 'run-1:post:telegram:account-1',
          requiresApproval: true,
        }],
      },
    },
  };

  await ingestAiRuntimeEvent(tx, event);

  assert.ok(statements.some((sql) => sql.includes("SET status = 'failed'")));
  assert.equal(statements.some((sql) => sql.includes('INSERT INTO approval_request')), false);
  assert.equal(statements.some((sql) => sql.includes("'execute_approved_actions'")), false);
});

// ---------- 迭代 4：报告外发审批分支 ----------

test('decideApproval on a report-delivery approval enqueues insight.deliver without touching workflow_run', async () => {
  const { decideApproval } = await import('./repository');
  const statements: string[] = [];
  const auditEvents: unknown[] = [];
  const deliveryPatches: unknown[] = [];
  const jobs: unknown[][] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      statements.push(sql);
      if (sql.startsWith('UPDATE approval_request')) {
        return { rows: [{ runId: null, insightReportId: 'report-1', actionPlan: { actionType: 'insight.deliver_report' } }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE insight_report SET delivery')) deliveryPatches.push(JSON.parse(String(values?.[2])));
      if (sql.startsWith('INSERT INTO job')) jobs.push([...(values ?? [])]);
      if (sql.startsWith('INSERT INTO audit_event')) auditEvents.push(values?.[2]);
      return { rows: [] as Row[], rowCount: 1 };
    },
  };
  const actor = { actorId: 'user-1', workspaceId: 'ws-1', role: 'owner' } as Parameters<typeof decideApproval>[1];

  const result = await decideApproval(tx, actor, 'approval-1', 'approved');

  assert.equal(result.runId, null);
  assert.equal(result.status, 'approved');
  assert.equal(statements.some((sql) => sql.includes('UPDATE workflow_run')), false);
  assert.deepEqual(deliveryPatches[0] ? { ...(deliveryPatches[0] as Record<string, unknown>), decidedAt: 'x' } : null, { status: 'approved', decidedBy: 'user-1', decidedAt: 'x' });
  assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO job') && sql.includes("'insight.deliver'")));
  assert.ok(auditEvents.includes('insight.delivery_approved'));
});

test('decideApproval rejection on a report-delivery approval marks the delivery rejected without a job', async () => {
  const { decideApproval } = await import('./repository');
  const deliveryPatches: unknown[] = [];
  const jobs: unknown[][] = [];
  const auditEvents: unknown[] = [];
  const tx: TenantTransaction = {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }> {
      if (sql.startsWith('UPDATE approval_request')) {
        return { rows: [{ runId: null, insightReportId: 'report-1', actionPlan: { actionType: 'insight.deliver_report' } }] as unknown as Row[], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE insight_report SET delivery')) deliveryPatches.push(JSON.parse(String(values?.[2])));
      if (sql.startsWith('INSERT INTO job')) jobs.push([...(values ?? [])]);
      if (sql.startsWith('INSERT INTO audit_event')) auditEvents.push(values?.[2]);
      return { rows: [] as Row[], rowCount: 1 };
    },
  };
  const actor = { actorId: 'user-1', workspaceId: 'ws-1', role: 'owner' } as Parameters<typeof decideApproval>[1];

  const result = await decideApproval(tx, actor, 'approval-1', 'rejected', 'wrong audience');

  assert.equal(result.status, 'rejected');
  assert.deepEqual(deliveryPatches[0] ? { ...(deliveryPatches[0] as Record<string, unknown>), decidedAt: 'x' } : null, { status: 'rejected', decidedBy: 'user-1', decidedAt: 'x' });
  assert.equal(jobs.length, 0);
  assert.ok(auditEvents.includes('insight.delivery_rejected'));
});
