import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActorContext } from '../contracts/domain';
import type { TenantTransaction } from '../foundation/database';
import { activatePipeline, createPipelineDraft, inspectPipelineReadiness, listPipelines, listPipelineTemplates, type PipelineDefinition, updatePipelineDraft } from './pipelines';

const pipelineId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const actor: ActorContext = { actorId: '33333333-3333-4333-8333-333333333333', workspaceId: '44444444-4444-4444-8444-444444444444', role: 'editor' };

test('pipeline catalogue exposes guided templates without leaking database definitions', () => {
  const templates = listPipelineTemplates();
  assert.deepEqual(templates.map((template) => template.id), ['repurpose', 'weekly_report', 'comment_lead']);
  assert.equal('definitionSteps' in templates[0]!, false);
  assert.deepEqual(templates.filter((template) => template.available).map((template) => template.id), ['repurpose']);
});

test('existing published workflows remain visible as imported pipelines', async () => {
  const tx = {
    async query<Row>() {
      return { rows: [{ id: pipelineId, name: 'Existing report', status: 'published', version: 1, updatedAt: '2026-09-04T00:00:00Z', definition: { name: 'Existing report', steps: [{ type: 'approval' }] } } as Row], rowCount: 1 };
    },
  } as TenantTransaction;
  const pipelines = await listPipelines(tx, actor);
  assert.equal(pipelines[0]?.definition.kind, 'pipeline');
  assert.equal(pipelines[0]?.definition.source.type, 'description');
  assert.deepEqual(pipelines[0]?.definition.targetAccountIds, []);
});

test('creating from a template saves a user-owned draft with approval guardrails', async () => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const tx = {
    async query<Row>(sql: string, values?: readonly unknown[]) {
      queries.push({ sql, values });
      if (sql.includes('INSERT INTO workflow (')) return { rows: [{ id: pipelineId, updatedAt: '2026-09-04T00:00:00Z' } as Row], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  } as TenantTransaction;

  const created = await createPipelineDraft(tx, actor, {
    name: 'Launch repurposing',
    source: { type: 'template', templateId: 'repurpose' },
    configuration: {
      brief: 'Turn the launch announcement into posts for our selected channels.',
      targetAccountIds: [accountId],
      approvalPolicy: 'required',
      tone: 'warm and direct',
      language: 'en',
    },
  });

  assert.equal(created.status, 'draft');
  assert.equal(created.definition.source.type, 'template');
  assert.ok(created.definition.steps.some((step) => step.type === 'approval'));
  const versionInsert = queries.find((query) => query.sql.includes('INSERT INTO workflow_version'));
  assert.deepEqual((versionInsert?.values?.[1] as PipelineDefinition).targetAccountIds, [accountId]);
  assert.ok(queries.some((query) => query.values?.includes('pipeline.draft_created')));
});

test('readiness reports missing account selection without activating the pipeline', async () => {
  const tx = pipelineTransaction({ targetAccountIds: [] });
  const result = await inspectPipelineReadiness(tx, actor, pipelineId);

  assert.equal(result.ready, false);
  assert.equal(result.checks.find((check) => check.id === 'accounts')?.passed, false);
  assert.equal(result.checks.find((check) => check.id === 'approval')?.passed, true);
});

test('activation refuses a draft that is not ready', async () => {
  const tx = pipelineTransaction({ targetAccountIds: [] });

  await assert.rejects(
    () => activatePipeline(tx, actor, pipelineId),
    /Pipeline is not ready to activate/,
  );
});

test('editing a draft creates a new immutable workflow version', async () => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const tx = {
    async query<Row>(sql: string, values?: readonly unknown[]) {
      queries.push({ sql, values });
      if (sql.includes('UPDATE workflow')) return { rows: [{ id: pipelineId, name: 'Updated pipeline', status: 'draft', version: 2, updatedAt: '2026-09-04T00:05:00Z' } as Row], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  } as TenantTransaction;

  const updated = await updatePipelineDraft(tx, actor, pipelineId, {
    name: 'Updated pipeline',
    source: { type: 'description', description: 'Create launch posts and send every draft through human review.' },
    configuration: { brief: 'Create launch posts and send every draft through human review.', targetAccountIds: [accountId], approvalPolicy: 'required', tone: 'direct', language: 'en' },
  });

  assert.equal(updated.version, 2);
  assert.ok(queries.some((query) => query.sql.includes('INSERT INTO workflow_version') && query.values?.[1] === 2));
  assert.ok(queries.some((query) => query.values?.includes('pipeline.draft_updated')));
});

test('activation requires healthy accounts and publishes a ready draft', async () => {
  const tx = pipelineTransaction({ targetAccountIds: [accountId] }, true);
  const result = await activatePipeline(tx, actor, pipelineId);

  assert.equal(result.status, 'published');
  assert.equal(result.definition.targetAccountIds[0], accountId);
  assert.equal(result.run.status, 'pending');
});

function pipelineTransaction(overrides: Partial<PipelineDefinition>, activate = false): TenantTransaction {
  const definition: PipelineDefinition = {
    kind: 'pipeline',
    source: { type: 'template', templateId: 'repurpose' },
    brief: 'Create a complete launch announcement for all selected channels.',
    targetAccountIds: [accountId],
    approvalPolicy: 'required',
    tone: 'clear, helpful',
    language: 'en',
    steps: [{ type: 'ai.prepare_announcement' }, { type: 'approval' }, { type: 'social.schedule_post' }],
    ...overrides,
  };
  return {
    async query<Row>(sql: string) {
      if (sql.includes('FROM workflow w')) {
        return { rows: [{ id: pipelineId, name: 'Launch repurposing', status: activate ? 'published' : 'draft', version: 1, updatedAt: '2026-09-04T00:00:00Z', definition } as Row], rowCount: 1 };
      }
      if (sql.includes('FROM connected_account')) {
        return { rows: definition.targetAccountIds.map((id) => ({ id, status: 'connected', platform: 'linkedin', externalAccountId: `external-${id}`, capabilities: ['social.create_post'] } as Row)), rowCount: definition.targetAccountIds.length };
      }
      if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', purchasedCredits: 0, subscriptionStatus: 'active', trialEndsAt: null, paymentGraceEndsAt: null } as Row], rowCount: 1 };
      if (sql.includes('INSERT INTO workflow_run')) return { rows: [{ id: 'run-1', status: 'pending', workflowId: pipelineId, createdAt: '2026-09-05' } as Row], rowCount: 1 };
      if (sql.includes('UPDATE workflow')) {
        return { rows: [{ id: pipelineId, name: 'Launch repurposing', status: 'published', version: 1, updatedAt: '2026-09-04T00:05:00Z' } as Row], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as TenantTransaction;
}

test('activation queues the configured announcement once and returns the same run on retry', async () => {
  const base = pipelineTransaction({ targetAccountIds: [accountId], tone: 'warm', language: 'es' }, true);
  const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  let inserted = false;
  const tx: TenantTransaction = {
    query: (async (sql: string, values: readonly unknown[] = []) => {
      queries.push({ sql, values });
      if (sql.includes('INSERT INTO workflow_run')) {
        if (inserted) return { rows: [], rowCount: 0 };
        inserted = true;
      }
      if (sql.startsWith('SELECT id, status') && sql.includes('FROM workflow_run')) return { rows: [{ id: 'run-1', status: 'pending' }], rowCount: 1 };
      return base.query(sql, values);
    }) as TenantTransaction['query'],
  };
  const first = await activatePipeline(tx, actor, pipelineId);
  const second = await activatePipeline(tx, actor, pipelineId);
  assert.equal(first.run.id, second.run.id);
  assert.equal(queries.filter(({ sql }) => sql.includes('INSERT INTO job')).length, 1);
  const values = queries.find(({ sql }) => sql.includes('INSERT INTO workflow_run'))!.values;
  assert.equal(values[3], `pipeline:${pipelineId}:v1:activation`);
  assert.deepEqual(values[4], { mode: 'publish', brief: 'Create a complete launch announcement for all selected channels.', targets: [{ platform: 'linkedin', accountId: `external-${accountId}` }] });
  assert.deepEqual(values[5], { tone: 'warm', language: 'es', forbiddenWords: [], approvalPolicy: 'required', allowedModelClasses: ['eco'] });
  assert.ok(queries.some(({ sql }) => sql.includes('FOR UPDATE OF w')));
});

test('unsupported templates fail readiness and never enqueue announcement jobs', async () => {
  const tx = pipelineTransaction({ steps: [{ type: 'social.get_analytics' }, { type: 'ai.summarize' }, { type: 'approval' }] });
  assert.equal((await inspectPipelineReadiness(tx, actor, pipelineId)).ready, false);
  await assert.rejects(() => activatePipeline(tx, actor, pipelineId), /not ready/);
});

test('activation rejects inactive workspaces before publishing or enqueueing', async () => {
  const queries: string[] = [];
  const base = pipelineTransaction({});
  const tx: TenantTransaction = { query: (async (sql: string, values?: readonly unknown[]) => {
    queries.push(sql);
    if (sql.includes('RETURNING plan')) return { rows: [{ plan: 'creator', subscriptionStatus: 'inactive', trialEndsAt: null, paymentGraceEndsAt: null }], rowCount: 1 };
    return base.query(sql, values);
  }) as TenantTransaction['query'] };
  await assert.rejects(() => activatePipeline(tx, actor, pipelineId), /automation_paused/);
  assert.equal(queries.some((sql) => sql.includes('UPDATE workflow') || sql.includes('INSERT INTO job')), false);
});
