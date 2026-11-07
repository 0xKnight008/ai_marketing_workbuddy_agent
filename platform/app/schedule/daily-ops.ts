import type { Context } from 'egg';

/** Check explicitly authorized schedules every minute; per-schedule runs are idempotent. */
export default {
  schedule: {
    interval: '60s',
    type: 'worker',
    immediate: false,
  },
  async task(ctx: Context): Promise<void> {
    if (ctx.app.config.env === 'unittest') return;
    const enqueued = await ctx.app.platform.service.enqueueScheduledDailyOps();
    if (enqueued > 0) ctx.logger.info('[daily-ops] enqueued %d workspace report(s)', enqueued);
  },
};
