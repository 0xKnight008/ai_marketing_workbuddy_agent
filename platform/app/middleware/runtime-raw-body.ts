import type { Context } from 'egg';

import { HttpError } from '../../src/http/errors';

const MAX_RUNTIME_EVENT_BYTES = 1_048_576;

export default () => async (ctx: Context, next: () => Promise<void>) => {
  if (ctx.path !== '/internal/ai-runtime-events') return next();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of ctx.req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > MAX_RUNTIME_EVENT_BYTES) throw new HttpError(413, 'payload_too_large');
    chunks.push(value);
  }
  const rawBody = Buffer.concat(chunks);
  try {
    ctx.request.body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  (ctx.state as { rawBody?: Buffer }).rawBody = rawBody;
  await next();
};
