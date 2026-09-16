import type { Context } from 'egg';

/**
 * 晚间复盘调度（Module 4）：每天 20:00 UTC 为配置了 evening_recap 规则的
 * 订阅工作区生成当日执行复盘并投递。幂等性由 notification_event 的
 * (workspace_id, dedup_key) 唯一约束保证。
 */
export default {
  schedule: {
    cron: '0 20 * * *',
    type: 'worker',
    immediate: false,
  },
  async task(ctx: Context): Promise<void> {
    if (ctx.app.config.env === 'unittest') return;
    const enqueued = await ctx.app.platform.service.enqueueEveningRecaps();
    if (enqueued > 0) ctx.logger.info('[evening-recap] enqueued %d recap(s)', enqueued);
  },
};
