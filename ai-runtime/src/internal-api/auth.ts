import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';

/**
 * 内部 API 鉴权中间件（§10：ai-runtime 只向可信内部服务暴露 API）。
 * run-service 调用时携带 `x-internal-token` 头。
 * 未配置 INTERNAL_API_TOKEN 时拒绝所有内部请求 —— 防止生产环境裸奔。
 *
 * 参数不做显式类型标注：Mastra 内置的 Hono 版本与独立 hono 包类型不完全兼容，
 * 交给 registerApiRoute 的上下文类型推断即可。
 */
export async function internalAuth(c: any, next: () => Promise<void>): Promise<any> {
  if (!config.internalApiToken) {
    return c.json({ error: 'INTERNAL_API_TOKEN is not configured on ai-runtime' }, 500);
  }
  const token = c.req.header('x-internal-token');
  if (!token || !tokensMatch(token, config.internalApiToken)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
}

function tokensMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}
