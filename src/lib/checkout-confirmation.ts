export async function confirmCheckout(gatewayUrl: string, sessionId: string | null, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<'confirmed' | 'signin'> {
  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) throw new Error('checkout_session_missing');
  if (!accessToken) return 'signin';
  const response = await fetchImpl(`${gatewayUrl}/api/billing/checkout-session/confirm`, {
    method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (response.status === 401) return 'signin';
  if (!response.ok) throw new Error('checkout_confirmation_failed');
  const usage = await response.json() as { subscriptionStatus?: string; trialEndsAt?: string };
  if (usage.subscriptionStatus !== 'active' && !(usage.subscriptionStatus === 'trialing' && Date.parse(usage.trialEndsAt ?? '') > Date.now())) throw new Error('checkout_not_entitled');
  return 'confirmed';
}

export const confirmationCopy = {
  zh: { pending: '正在向 Stripe 核验订阅并同步工作区…', ready: '订阅已确认，工作区已同步。免费试用无需等待首次扣款。', failed: '订阅尚未确认，请重试或联系支持。不要重复购买。', retry: '重新确认订阅' },
  en: { pending: 'Verifying your subscription with Stripe and syncing your workspace…', ready: 'Subscription verified and workspace synced. Free trials do not require an initial charge.', failed: 'Your subscription could not be confirmed yet. Retry or contact support; do not purchase again.', retry: 'Retry confirmation' },
  es: { pending: 'Verificando la suscripción con Stripe y sincronizando el espacio…', ready: 'Suscripción verificada y espacio sincronizado. La prueba gratuita no requiere un cargo inicial.', failed: 'Aún no se pudo confirmar la suscripción. Reintenta o contacta con soporte; no vuelvas a comprar.', retry: 'Reintentar confirmación' },
};
