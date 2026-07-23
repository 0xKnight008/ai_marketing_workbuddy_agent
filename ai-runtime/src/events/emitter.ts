import { createHmac, randomUUID } from 'node:crypto';
import { config } from '../config';
import {
  aiRuntimeEventSchema,
  type AiRuntimeEvent,
  type AiRuntimeEventType,
} from '../schemas/events';

/**
 * ai-runtime → run-service 的事件发射器（架构文档 §7）。
 *
 * 设计要点：
 * - 每个 ai run 一个 emitter 实例，绑定 platformRunId / aiRunId。
 * - 投递失败按指数退避重试；最终失败只记录日志，不中断 workflow ——
 *   run-service 始终可以通过轮询 GET /internal/ai-runs/{aiRunId} 兜底。
 * - 配置了 EVENT_CALLBACK_SIGNING_SECRET 时用 HMAC-SHA256 签名，
 *   run-service 侧可校验 X-Ai-Runtime-Signature 头。
 * - 回调目的地只由运行时配置决定，绝不接受请求中的 URL，避免内部服务请求伪造。
 */
export class RunServiceEventEmitter {
  constructor(
    private readonly platformRunId: string,
    private readonly aiRunId: string,
  ) {}

  async emit(type: AiRuntimeEventType, payload: Record<string, unknown> = {}): Promise<void> {
    const event: AiRuntimeEvent = aiRuntimeEventSchema.parse({
      eventId: `evt_${randomUUID()}`,
      platformRunId: this.platformRunId,
      aiRunId: this.aiRunId,
      type,
      createdAt: new Date().toISOString(),
      payload,
    });

    const url = config.runServiceCallbackUrl;

    const body = JSON.stringify(event);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.eventCallbackSigningSecret) {
      headers['x-ai-runtime-signature'] = createHmac('sha256', config.eventCallbackSigningSecret)
        .update(body)
        .digest('hex');
    }

    for (let attempt = 1; attempt <= config.eventCallbackMaxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(config.eventCallbackTimeoutMs),
        });
        if (res.ok) return;
        throw new Error(`callback responded ${res.status}`);
      } catch (err) {
        const last = attempt === config.eventCallbackMaxRetries;
        const level = last ? 'error' : 'warn';
        console[level](
          `[ai-runtime:event] deliver ${type} attempt ${attempt}/${config.eventCallbackMaxRetries} failed`,
          err instanceof Error ? err.message : err,
        );
        if (last) return; // 不中断 workflow，run-service 轮询兜底
        await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
      }
    }
  }
}

/**
 * aiRunId → emitter 注册表。
 * workflow step 内通过 runId 取回 emitter（见 workflows/ 中的 withStepEvents）。
 */
const emitterRegistry = new Map<string, RunServiceEventEmitter>();

export function registerEmitter(aiRunId: string, emitter: RunServiceEventEmitter): void {
  emitterRegistry.set(aiRunId, emitter);
}

export function getEmitter(aiRunId: string): RunServiceEventEmitter {
  const emitter = emitterRegistry.get(aiRunId);
  if (!emitter) {
    throw new Error(`No event emitter registered for aiRunId=${aiRunId}`);
  }
  return emitter;
}

export function removeEmitter(aiRunId: string): void {
  emitterRegistry.delete(aiRunId);
}
