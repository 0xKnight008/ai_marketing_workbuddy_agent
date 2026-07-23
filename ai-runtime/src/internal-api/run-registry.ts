import { createClient } from '@libsql/client';

import { config } from '../config';
import {
  prepareAnnouncementResultSchema,
  type PrepareAnnouncementResult,
} from '../schemas/announcement';

/**
 * aiRunId ↔ platformRunId 的运行态注册表。
 *
 * 与 Mastra 共用 LibSQL storage，因此任意 API 实例都能响应轮询请求，进程重启后
 * 仍保留结果。生产环境由 config 拒绝本地 file storage，避免副本之间状态分裂。
 */

export type AiRunStatus = 'accepted' | 'running' | 'succeeded' | 'failed';

export interface AiRunRecord {
  aiRunId: string;
  platformRunId: string;
  workspaceId: string;
  actorId: string;
  status: AiRunStatus;
  result?: PrepareAnnouncementResult;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

const client = createClient({
  url: config.storageUrl,
  authToken: config.storageAuthToken,
});

let initializePromise: Promise<void> | undefined;

async function initialize(): Promise<void> {
  if (!initializePromise) {
    const initialization = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS ai_runtime_run_registry (
          ai_run_id TEXT PRIMARY KEY,
          platform_run_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          status TEXT NOT NULL,
          result_json TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          finished_at TEXT,
          expires_at TEXT NOT NULL
        )
      `);
      await client.execute(
        'CREATE INDEX IF NOT EXISTS ai_runtime_run_registry_expires_at ON ai_runtime_run_registry (expires_at)',
      );
    })();
    initializePromise = initialization.catch((error) => {
      // A temporary database outage must not permanently poison this process.
      initializePromise = undefined;
      throw error;
    });
  }
  await initializePromise;
}

function now(): string {
  return new Date().toISOString();
}

function expiry(): string {
  return new Date(Date.now() + config.runRegistryRetentionMs).toISOString();
}

async function deleteExpiredRuns(): Promise<void> {
  await client.execute({
    sql: 'DELETE FROM ai_runtime_run_registry WHERE expires_at <= ?',
    args: [now()],
  });
}

export async function createAiRunRecord(
  record: Pick<AiRunRecord, 'aiRunId' | 'platformRunId' | 'workspaceId' | 'actorId'>,
): Promise<AiRunRecord> {
  await initialize();
  await deleteExpiredRuns();
  const createdAt = now();
  const full: AiRunRecord = { ...record, status: 'accepted', createdAt };
  await client.execute({
    sql: `
      INSERT INTO ai_runtime_run_registry (
        ai_run_id, platform_run_id, workspace_id, actor_id, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      full.aiRunId,
      full.platformRunId,
      full.workspaceId,
      full.actorId,
      full.status,
      full.createdAt,
      expiry(),
    ],
  });
  return full;
}

export async function getAiRunRecord(aiRunId: string): Promise<AiRunRecord | undefined> {
  await initialize();
  await deleteExpiredRuns();
  const result = await client.execute({
    sql: `
      SELECT ai_run_id, platform_run_id, workspace_id, actor_id, status,
             result_json, error, created_at, finished_at
      FROM ai_runtime_run_registry
      WHERE ai_run_id = ?
    `,
    args: [aiRunId],
  });
  const row = result.rows[0];
  if (!row) return undefined;

  const resultJson = nullableStringValue(row.result_json);
  return {
    aiRunId: stringValue(row.ai_run_id),
    platformRunId: stringValue(row.platform_run_id),
    workspaceId: stringValue(row.workspace_id),
    actorId: stringValue(row.actor_id),
    status: aiRunStatus(stringValue(row.status)),
    result: resultJson
      ? prepareAnnouncementResultSchema.parse(JSON.parse(resultJson))
      : undefined,
    error: nullableStringValue(row.error),
    createdAt: stringValue(row.created_at),
    finishedAt: nullableStringValue(row.finished_at),
  };
}

export async function updateAiRunRecord(
  aiRunId: string,
  patch: Partial<Pick<AiRunRecord, 'status' | 'result' | 'error' | 'finishedAt'>>,
): Promise<void> {
  await initialize();
  await client.execute({
    sql: `
      UPDATE ai_runtime_run_registry
      SET status = ?,
          result_json = COALESCE(?, result_json),
          error = COALESCE(?, error),
          finished_at = COALESCE(?, finished_at),
          expires_at = ?
      WHERE ai_run_id = ?
    `,
    args: [
      patch.status ?? 'running',
      patch.result === undefined ? null : JSON.stringify(patch.result),
      patch.error ?? null,
      patch.finishedAt ?? null,
      expiry(),
      aiRunId,
    ],
  });
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid ai runtime run registry record');
  return value;
}

function nullableStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return stringValue(value);
}

function aiRunStatus(value: string): AiRunStatus {
  if (value === 'accepted' || value === 'running' || value === 'succeeded' || value === 'failed') {
    return value;
  }
  throw new Error(`Invalid ai runtime run status: ${value}`);
}
