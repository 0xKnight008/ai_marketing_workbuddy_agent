import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('persists a run record before a workflow result exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'piggybot-ai-runtime-'));
  process.env.MASTRA_STORAGE_URL = `file:${join(directory, 'registry.db')}`;

  try {
    const { createAiRunRecord, getAiRunRecord, updateAiRunRecord } = await import('./run-registry');
    await createAiRunRecord({
      aiRunId: 'ai_run_123',
      platformRunId: 'platform_run_123',
      workspaceId: 'workspace_123',
      actorId: 'actor_123',
    });
    await updateAiRunRecord('ai_run_123', { status: 'running' });

    const record = await getAiRunRecord('ai_run_123');
    assert.equal(record?.aiRunId, 'ai_run_123');
    assert.equal(record?.platformRunId, 'platform_run_123');
    assert.equal(record?.workspaceId, 'workspace_123');
    assert.equal(record?.actorId, 'actor_123');
    assert.equal(record?.status, 'running');
    assert.equal(record?.result, undefined);
    assert.equal(record?.error, undefined);
    assert.ok(record?.createdAt);
    assert.equal(record?.finishedAt, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
