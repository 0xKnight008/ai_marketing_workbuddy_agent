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
      // These routes use explicit Bearer or HMAC credentials rather than
      // browser cookies. Keep Egg CSRF protection enabled for every other
      // route, especially any future cookie/session endpoint.
      ignore: (ctx: { path: string }) =>
        ctx.path.startsWith('/api/') ||
        ctx.path === '/internal/ai-runtime-events' ||
        ctx.path === '/webhooks/stripe',
    },
  },
  bodyParser: {
    // The runtime event signature covers original bytes, so this one endpoint
    // is parsed by runtimeRawBody before the standard JSON parser sees it.
    ignore: (ctx: { path: string }) => ctx.path === '/internal/ai-runtime-events' || ctx.path === '/webhooks/stripe',
    jsonLimit: '1mb',
  },
  middleware: ['platformError', 'platformCors', 'runtimeRawBody'],
  platformCors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',').map((origin) => origin.trim()).filter(Boolean),
  },
});
