export type BillingInterval = 'month' | 'year';

// 年付的前端入口已移除——Stripe 结账内提供 upsell。这里仅保留 URL 参数解析，
// 让改版前外发的 ?billingInterval=year 链接继续生效，不要在界面上重新加回年付开关。
export function selectedBillingInterval(search: string): BillingInterval {
  return new URLSearchParams(search).get('billingInterval') === 'year' ? 'year' : 'month';
}
