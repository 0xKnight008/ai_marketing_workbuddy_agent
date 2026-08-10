import assert from 'node:assert/strict';
import test from 'node:test';

import type { AiRuntimeEvent } from '../contracts/ai-runtime-event';
import type { TenantTransaction } from '../foundation/database';
import { ingestAiRuntimeEvent } from './repository';

test('compliance-blocked action plans fail the run without creating an approval or execution job', async () => {
  const statements: string[] = [];
  const tx: TenantTransaction = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT id, status FROM workflow_run')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111', status: 'running' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO run_event')) return { rows: [{ id: 'event-1' }], rowCount: 1 };
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
