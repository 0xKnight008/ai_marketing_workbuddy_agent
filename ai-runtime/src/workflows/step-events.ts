import { getEmitter } from '../events/emitter';
import type { WorkflowStepId } from '../schemas/events';

/**
 * 为 workflow step 包一层 ai_step.* 事件上报（§7）。
 * step 内部只需关心业务逻辑，事件由这里统一发出；
 * 上报失败不影响 step 执行。
 */
export async function withStepEvents<T>(
  aiRunId: string,
  stepId: WorkflowStepId,
  fn: () => Promise<T>,
  extraPayload: (result: T) => Record<string, unknown> = () => ({}),
): Promise<T> {
  const emitter = getEmitter(aiRunId);
  await emitter.emit('ai_step.started', { stepId });
  try {
    const result = await fn();
    await emitter.emit('ai_step.succeeded', { stepId, ...extraPayload(result) });
    return result;
  } catch (err) {
    await emitter.emit('ai_step.failed', {
      stepId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
