import type { Context } from 'egg';

export default (options: { origins?: string[] }) => async (ctx: Context, next: () => Promise<void>) => {
  const origin = ctx.get('origin');
  if (origin && options.origins?.includes(origin)) {
    ctx.set('Access-Control-Allow-Origin', origin);
    ctx.set('Vary', 'Origin');
    ctx.set('Access-Control-Allow-Credentials', 'true');
    ctx.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-AI-Runtime-Signature');
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (ctx.method === 'OPTIONS') {
    ctx.status = 204;
    return;
  }
  await next();
};
