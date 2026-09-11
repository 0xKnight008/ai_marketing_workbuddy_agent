import type { Context } from 'egg';

/**
 * 每日运营任务调度（P1）：每天早上 07:00 为符合条件的订阅工作区生成
 * daily_ops 洞察报告。幂等性由 enqueue_daily_ops_reports() 的
 * 20 小时去重窗口保证。
 */
export default {
  schedule: {
    cron: '0 7 * * *',
    type: 'worker',
    immediate: false,
  },
  async task(ctx: Context): Promise<void> {
    if (ctx.app.config.env === 'unittest') return;
    const enqueued = await ctx.app.platform.service.enqueueScheduledDailyOps();
    if (enqueued > 0) ctx.logger.info('[daily-ops] enqueued %d workspace report(s)', enqueued);
  },
};
