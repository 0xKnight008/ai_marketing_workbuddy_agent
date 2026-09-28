import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ActionPlan } from '../contracts/ai-runtime-event';
import { SupplierUnavailableError } from '../zernio/client';
import { providerPlatform, type ZernioPostResult } from '../zernio/posts';
import type { ClaimedJob, RunWorkerDatabase, RunWorkerZernio } from './worker-runner';

export class ZernioPostPending extends SupplierUnavailableError {
  constructor(readonly postId: string) { super(`Zernio post ${postId} is awaiting publication`); }
}

const resultSchema = z.object({
  postId: z.string().min(1), status: z.enum(['pending', 'published', 'failed']),
  platform: z.string(), accountId: z.string(), platformPostUrl: z.string().optional(),
});
const receiptSchema = z.object({ startedAt: z.number().finite(), actionHash: z.string(), result: resultSchema.optional() });

export function hasSubmittedPost(job: ClaimedJob, action: ActionPlan['actions'][number]): boolean {
  const receipt = z.record(receiptSchema).parse(job.payload.zernioReceipts ?? {})[action.idempotencyKey];
  return Boolean(receipt?.result && receipt.actionHash === createHash('sha256').update(JSON.stringify(action)).digest('hex'));
}

/** Called under the job lease. Receipts survive retries/restarts in the durable job payload. */
export async function publishConfirmed(database: RunWorkerDatabase, provider: RunWorkerZernio,
  job: ClaimedJob, action: ActionPlan['actions'][number], now = Date.now()): Promise<ZernioPostResult> {
  const key = action.idempotencyKey;
  const hash = createHash('sha256').update(JSON.stringify(action)).digest('hex');
  const receipts = z.record(receiptSchema).parse(job.payload.zernioReceipts ?? {});
  let receipt = receipts[key];
  if (receipt && receipt.actionHash !== hash) throw new Error('Zernio action changed after submission; review required');
  const save = async () => {
    await database.withWorkspace(job.workspaceId, async tx => {
      const updated = await tx.query(`UPDATE job SET payload = jsonb_set(payload, '{zernioReceipts}',
        COALESCE(payload->'zernioReceipts', '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb)), updated_at = now()
        WHERE id = $1 AND workspace_id = $2`, [job.id, job.workspaceId, key, JSON.stringify(receipt)]);
      if (updated.rowCount !== 1) throw new Error('Zernio publication receipt was not saved');
    });
    receipts[key] = receipt!;
    job.payload.zernioReceipts = receipts;
  };
  if (!receipt) {
    receipt = { startedAt: now, actionHash: hash };
    // Record intent before POST, including failures with ambiguous network outcomes.
    await save();
  }
  let result = receipt.result;
  if (result?.status === 'pending') {
    const scheduled = action.mode === 'schedule' && action.scheduledAt ? Date.parse(action.scheduledAt) : receipt.startedAt;
    if (now > Math.max(receipt.startedAt, scheduled) + 24 * 60 * 60 * 1000) {
      throw new Error(`Zernio post ${result.postId} reconciliation timed out; review required`);
    }
    if (!provider.getActionResult) throw new Error('Zernio reconciliation is not configured');
    const refreshed = resultSchema.parse(await provider.getActionResult(result.postId, action, job.workspaceId));
    if (refreshed.postId !== result.postId) throw new Error('Zernio reconciliation post ID mismatch');
    result = refreshed;
  } else if (!result) {
    // Zernio guarantees replay for 24h only. Never blindly POST after that window.
    if (now - receipt.startedAt >= 23 * 60 * 60 * 1000) throw new Error('Zernio submission outcome unknown; manual reconciliation required');
    result = resultSchema.parse(await provider.executeAction(key, action, job.workspaceId));
  }
  if (result.accountId !== action.accountId || result.platform !== providerPlatform(action.platform)) {
    throw new Error('Zernio publication target mismatch');
  }
  receipt.result = result;
  await save();
  if (result.status === 'pending') throw new ZernioPostPending(result.postId);
  if (result.status !== 'published') throw new Error(`Zernio post ${result.postId} was not published`);
  return result;
}
