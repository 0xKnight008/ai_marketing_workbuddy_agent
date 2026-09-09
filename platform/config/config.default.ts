import type { EggAppInfo } from 'egg';

export default (appInfo: EggAppInfo) => ({
  cluster: {
    listen: {
      port: Number(process.env.GATEWAY_PORT ?? 4100),
      hostname: '0.0.0.0',
    },
  },
  keys: process.env.EGG_COOKIE_KEYS ?? `${appInfo.name}-replace-in-production`,
  proxy: process.env.TRUST_PROXY === 'true',
  security: {
    csrf: {
      // Workspace APIs use Bearer/HMAC credentials. Cookie-based admin APIs
      // enforce an exact trusted Origin in adminEmailSession for all writes.
      ignore: (ctx: { path: string }) =>
        ctx.path.startsWith('/api/') ||
        ctx.path === '/internal/ai-runtime-events' ||
        ctx.path === '/webhooks/stripe',
    },
  },
  bodyParser: {
    // Signed runtime and Stripe events cover original bytes, so these endpoints
    // are parsed by runtimeRawBody before the standard JSON parser sees them.
    ignore: (ctx: { path: string }) => ctx.path === '/internal/ai-runtime-events' || ctx.path === '/webhooks/stripe',
    jsonLimit: '1mb',
  },
  middleware: ['platformError', 'platformCors', 'runtimeRawBody', 'adminEmailSession'],
  platformCors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',').map((origin) => origin.trim()).filter(Boolean),
  },
});
