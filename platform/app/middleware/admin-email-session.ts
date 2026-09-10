import type { Context } from 'egg';
import { ADMIN_COOKIE } from '../../src/admin/email-login';

export default function adminEmailSession() {
  return async (ctx: Context, next: () => Promise<void>) => {
    if (!ctx.path.startsWith('/api/admin/')) return next();
    ctx.set('Cache-Control', 'no-store');
    ctx.set('Referrer-Policy', 'no-referrer');
    const login = ctx.app.platform.service.adminEmailLogin;
    const session = ctx.cookies.get(ADMIN_COOKIE, { signed: false });
    const authRoute = ctx.path.startsWith('/api/admin/auth/');
    if ((session || authRoute) && !['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)) login.assertOrigin(ctx.get('origin'));
    if (session && (!authRoute || ctx.path === '/api/admin/auth/session')) {
      ctx.state.platformAdminActor = await login.authenticate(session);
    }
    await next();
  };
}
