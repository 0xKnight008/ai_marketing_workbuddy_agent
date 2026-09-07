export type BillingInterval = 'month' | 'year';

export function selectedBillingInterval(search: string): BillingInterval {
  return new URLSearchParams(search).get('billingInterval') === 'year' ? 'year' : 'month';
}

// Annual amounts/discounts are not defined in the product configuration yet.
// Do not present monthly prices (or an invented x12 price) as annual prices.
export const billingCopy = {
  en: { label: 'Billing cycle', month: 'Monthly', year: 'Yearly', annualPrice: 'Annual price at checkout', annualNote: 'The annual total is shown in Stripe before you confirm payment. Monthly usage limits remain unchanged.' },
  zh: { label: '计费周期', month: '月付', year: '年付', annualPrice: '年度价格见结账页', annualNote: '确认付款前，Stripe 将显示年度总价。每月使用额度保持不变。' },
  es: { label: 'Ciclo de facturación', month: 'Mensual', year: 'Anual', annualPrice: 'Precio anual al pagar', annualNote: 'Stripe muestra el total anual antes de confirmar el pago. Los límites de uso mensuales no cambian.' },
} as const;
