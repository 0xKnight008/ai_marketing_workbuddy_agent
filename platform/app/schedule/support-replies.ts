import type { Context } from 'egg';

export default {
  schedule: { interval: '15s', type: 'worker', immediate: true },
  async task(ctx: Context): Promise<void> {
    if (ctx.app.config.env === 'unittest') return;
    await ctx.app.platform.service.deliverSupportReplies();
  },
};
