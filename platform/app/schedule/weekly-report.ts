import type { Context } from 'egg';

/**
 * 周报调度（Module 4）：每周一 08:00 UTC 为配置了 weekly_report 规则的
 * 订阅工作区入队周报生成（6 天去重）。报告生成成功后由 worker 的
 * notification.plan 按规则的 delivery mode 决定直接投递或进入人工审批。
 */
export default {
  schedule: {
    cron: '0 8 * * 1',
    type: 'worker',
    immediate: false,
  },
  async task(ctx: Context): Promise<void> {
    if (ctx.app.config.env === 'unittest') return;
    const enqueued = await ctx.app.platform.service.enqueueWeeklyReports();
    if (enqueued > 0) ctx.logger.info('[weekly-report] enqueued %d report(s)', enqueued);
  },
};
