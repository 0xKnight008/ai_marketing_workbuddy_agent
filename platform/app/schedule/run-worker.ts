import type { Context } from 'egg';

export default {
  schedule: {
    interval: '3s',
    type: 'worker',
    immediate: true,
  },
  async task(ctx: Context): Promise<void> {
    if (ctx.app.config.env === 'unittest') return;
    await ctx.app.platform.worker.drain(ctx.app.platform.workerBatchSize);
  },
};
