import { ArrowRight, CheckCircle2, CreditCard, LoaderCircle, LockKeyhole } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { Lang } from '../i18n/content';
import { readSessionAccessToken, storeSessionAccessToken } from '../lib/auth-session';

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:4100';
const publicCheckoutEnabled = import.meta.env.VITE_PUBLIC_CHECKOUT_ENABLED === 'true';
const plans = ['creator', 'growth', 'agency'] as const;
type Plan = (typeof plans)[number];

const copy = {
  zh: {
    eyebrow: '服务激活', title: '选择计划，安全前往 Stripe', description: '支付由 Stripe 托管。成功付款后，Piggybot 仅接受 Stripe 已验证的事件来激活你的工作区。',
    unavailable: '线上购买暂未开放。请联系我们加入受控测试。', continue: '安全前往 Stripe', processing: '正在创建安全结账…', back: '返回价格方案', secure: '银行卡信息不会经过 Piggybot。',
    success: '付款已完成。Stripe 正在安全地确认付款并激活你的工作区。', successNext: '请查收激活邮件。邮件中的一次性链接会安全登录并带你进入控制台。', activating: '正在安全激活你的工作区…', activationFailed: '此激活链接无效、已过期或已使用。请联系支持团队获取新链接。', console: '进入控制台', cancelled: '结账已取消，尚未更改你的计划。', failed: '无法创建 Stripe 结账。请检查会话和服务配置后重试。', referral: '你正在通过好友推荐加入 Piggybot。',
    plans: { creator: 'Creator · $19 / 月', growth: 'Growth · $59 / 月', agency: 'Agency · $169 / 月' },
  },
  en: {
    eyebrow: 'Service activation', title: 'Choose a plan, then continue securely to Stripe', description: 'Stripe hosts payment. Piggybot activates a workspace only from a Stripe-verified event after payment succeeds.',
    unavailable: 'Online checkout is not open yet. Contact us to join the controlled beta.', continue: 'Continue securely to Stripe', processing: 'Creating secure checkout…', back: 'Back to pricing', secure: 'Card details never pass through Piggybot.',
    success: 'Payment is complete. Stripe is securely confirming it and activating your workspace.', successNext: 'Check your email. Its one-time activation link will sign you in securely and take you to the console.', activating: 'Securely activating your workspace…', activationFailed: 'This activation link is invalid, expired, or already used. Contact support for a new link.', console: 'Enter console', cancelled: 'Checkout was cancelled. Your plan has not changed.', failed: 'Stripe Checkout could not be created. Check your session and service configuration, then try again.', referral: 'You’re joining Piggybot through a friend’s referral.',
    plans: { creator: 'Creator · $19 / mo', growth: 'Growth · $59 / mo', agency: 'Agency · $169 / mo' },
  },
  es: {
    eyebrow: 'Activación del servicio', title: 'Elige un plan y continúa de forma segura con Stripe', description: 'Stripe aloja el pago. Piggybot solo activa un espacio de trabajo desde un evento verificado por Stripe tras un pago correcto.',
    unavailable: 'El pago en línea aún no está abierto. Contáctanos para participar en la beta controlada.', continue: 'Continuar de forma segura con Stripe', processing: 'Creando pago seguro…', back: 'Volver a precios', secure: 'Los datos de la tarjeta nunca pasan por Piggybot.',
    success: 'El pago se completó. Stripe lo está confirmando de forma segura y activando tu espacio.', successNext: 'Revisa tu correo. El enlace de activación de un solo uso iniciará sesión de forma segura y te llevará a la consola.', activating: 'Activando tu espacio de forma segura…', activationFailed: 'Este enlace de activación no es válido, ha caducado o ya se usó. Contacta con soporte para obtener uno nuevo.', console: 'Entrar en la consola', cancelled: 'El pago se canceló. Tu plan no cambió.', failed: 'No se pudo crear Stripe Checkout. Revisa la sesión y la configuración del servicio e inténtalo de nuevo.', referral: 'Te unes a Piggybot mediante la recomendación de un amigo.',
    plans: { creator: 'Creator · $19 / mes', growth: 'Growth · $59 / mes', agency: 'Agency · $169 / mes' },
  },
} as const;

function selectedPlan(): Plan {
  const value = new URLSearchParams(window.location.search).get('plan');
  return plans.includes(value as Plan) ? value as Plan : 'growth';
}

export default function Activation({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const [plan, setPlan] = useState<Plan>(selectedPlan);
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const result = useMemo(() => new URLSearchParams(window.location.search).get('checkout'), []);
  const referralCode = useMemo(() => new URLSearchParams(window.location.search).get('ref')?.toUpperCase(), []);
  const ticket = useMemo(() => new URLSearchParams(window.location.search).get('ticket'), []);
  const [activationState, setActivationState] = useState<'idle' | 'activating' | 'error'>(ticket ? 'activating' : 'idle');
  const exchangeStarted = useRef(false);
  const home = `/${lang}/`;

  useEffect(() => {
    if (!ticket || exchangeStarted.current) return;
    exchangeStarted.current = true;
    void (async () => {
      try {
        const response = await fetch(`${gatewayUrl}/api/activation/exchange`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ticket }),
        });
        const body = await response.json().catch(() => ({})) as { accessToken?: unknown };
        if (!response.ok || typeof body.accessToken !== 'string') throw new Error('activation failed');
        storeSessionAccessToken(body.accessToken);
        window.location.replace('/app');
      } catch {
        setActivationState('error');
      }
    })();
  }, [ticket]);

  async function startCheckout() {
    if (!publicCheckoutEnabled) { setState('error'); setMessage(t.unavailable); return; }
    const token = readSessionAccessToken().trim();
    if (!token) { setState('error'); setMessage(t.unavailable); return; }
    setState('sending'); setMessage('');
    try {
      const response = await fetch(`${gatewayUrl}/api/billing/checkout-session`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ plan, referralCode }),
      });
      const body = await response.json().catch(() => ({})) as { url?: unknown };
      if (!response.ok || typeof body.url !== 'string') throw new Error('checkout unavailable');
      window.location.assign(body.url);
    } catch {
      setState('error'); setMessage(t.failed);
    }
  }

  return (
    <main className="paper-grain min-h-screen bg-paper px-4 py-10 text-ink sm:px-6">
      <section className="mx-auto max-w-xl sketch wobble bg-paper-card p-6 shadow-paint sm:p-9">
        <p className="font-hand text-xl text-sky-deep">{t.eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl leading-tight sm:text-4xl">{t.title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">{t.description}</p>

        {!ticket && referralCode && <Notice tone="success">{t.referral}</Notice>}
        {ticket && activationState === 'activating' && <Notice tone="neutral"><LoaderCircle className="h-5 w-5 shrink-0 animate-spin" />{t.activating}</Notice>}
        {ticket && activationState === 'error' && <Notice tone="error">{t.activationFailed}</Notice>}
        {!ticket && result === 'success' && <>
          <Notice tone="success"><CheckCircle2 className="h-5 w-5 shrink-0" />{t.success}</Notice>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">{t.successNext}</p>
          <a href="/app" className="mt-5 flex w-full items-center justify-center gap-2 bg-sky-deep px-5 py-3 font-display text-white sketch shadow-paint transition hover:-translate-y-0.5"><ArrowRight className="h-4 w-4" />{t.console}</a>
        </>}
        {!ticket && result === 'cancelled' && <Notice tone="neutral">{t.cancelled}</Notice>}

        {!ticket && result !== 'success' && <>
          <label className="mt-7 block text-sm font-bold">Plan</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {plans.map((candidate) => <button key={candidate} type="button" onClick={() => setPlan(candidate)} className={`sketch px-3 py-3 text-sm font-bold transition ${candidate === plan ? 'bg-sunset text-white shadow-paint-sm' : 'bg-paper text-ink-soft hover:bg-sun/30'}`}>{t.plans[candidate]}</button>)}
          </div>

          {!publicCheckoutEnabled && <Notice tone="neutral">{t.unavailable}</Notice>}
          {state === 'error' && <Notice tone="error">{message}</Notice>}
          <button type="button" disabled={state === 'sending' || !publicCheckoutEnabled} onClick={() => void startCheckout()} className="mt-5 flex w-full items-center justify-center gap-2 bg-sky-deep px-5 py-3 font-display text-white sketch shadow-paint transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"><CreditCard className="h-4 w-4" />{state === 'sending' ? t.processing : t.continue}</button>
          <p className="mt-3 flex items-start gap-2 text-xs text-ink-faint"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.secure}</p>
        </>}
        <a href={home} className="mt-6 inline-block text-sm font-bold text-sky-deep hover:underline">← {t.back}</a>
      </section>
    </main>
  );
}

function Notice({ tone, children }: { tone: 'success' | 'neutral' | 'error'; children: React.ReactNode }) {
  const colors = { success: 'bg-meadow/15 text-meadow-deep', neutral: 'bg-sun/20 text-ink-soft', error: 'bg-sunset/15 text-sunset-deep' };
  return <p className={`mt-5 flex items-start gap-2 rounded-lg p-3 text-sm leading-relaxed ${colors[tone]}`}>{children}</p>;
}
