import { CheckCircle2, CreditCard, LockKeyhole } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { Lang } from '../i18n/content';

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:4100';
const plans = ['creator', 'growth', 'agency'] as const;
type Plan = (typeof plans)[number];

const copy = {
  zh: {
    eyebrow: '服务激活', title: '选择计划，安全前往 Stripe', description: '支付由 Stripe 托管。成功付款后，Piggybot 仅接受 Stripe 已验证的事件来激活你的工作区。',
    token: '工作区所有者访问令牌', tokenHint: '当前预览版使用工作区令牌确认归属；正式版将由登录会话自动提供。',
    tokenPlaceholder: '粘贴短期工作区所有者令牌', continue: '安全前往 Stripe', processing: '正在创建安全结账…', back: '返回价格方案', secure: '银行卡信息不会经过 Piggybot。',
    success: '付款已完成。Stripe 正在安全地确认付款并激活你的工作区。', cancelled: '结账已取消，尚未更改你的计划。', missing: '请输入工作区所有者访问令牌。', failed: '无法创建 Stripe 结账。请检查令牌和服务配置后重试。',
    plans: { creator: 'Creator · $19 / 月', growth: 'Growth · $59 / 月', agency: 'Agency · $169 / 月' },
  },
  en: {
    eyebrow: 'Service activation', title: 'Choose a plan, then continue securely to Stripe', description: 'Stripe hosts payment. Piggybot activates a workspace only from a Stripe-verified event after payment succeeds.',
    token: 'Workspace owner access token', tokenHint: 'This preview uses a workspace token to identify the owner; production sign-in will supply this from the session.',
    tokenPlaceholder: 'Paste a short-lived workspace owner token', continue: 'Continue securely to Stripe', processing: 'Creating secure checkout…', back: 'Back to pricing', secure: 'Card details never pass through Piggybot.',
    success: 'Payment is complete. Stripe is securely confirming it and activating your workspace.', cancelled: 'Checkout was cancelled. Your plan has not changed.', missing: 'Enter a workspace owner access token.', failed: 'Stripe Checkout could not be created. Check the token and service configuration, then try again.',
    plans: { creator: 'Creator · $19 / mo', growth: 'Growth · $59 / mo', agency: 'Agency · $169 / mo' },
  },
  es: {
    eyebrow: 'Activación del servicio', title: 'Elige un plan y continúa de forma segura con Stripe', description: 'Stripe aloja el pago. Piggybot solo activa un espacio de trabajo desde un evento verificado por Stripe tras un pago correcto.',
    token: 'Token de acceso del propietario del espacio', tokenHint: 'Esta vista previa usa un token de espacio para identificar al propietario; el inicio de sesión de producción lo aportará desde la sesión.',
    tokenPlaceholder: 'Pega un token temporal del propietario', continue: 'Continuar de forma segura con Stripe', processing: 'Creando pago seguro…', back: 'Volver a precios', secure: 'Los datos de la tarjeta nunca pasan por Piggybot.',
    success: 'El pago se completó. Stripe lo está confirmando de forma segura y activando tu espacio.', cancelled: 'El pago se canceló. Tu plan no cambió.', missing: 'Introduce un token de propietario del espacio.', failed: 'No se pudo crear Stripe Checkout. Revisa el token y la configuración del servicio e inténtalo de nuevo.',
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
  const [token, setToken] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const result = useMemo(() => new URLSearchParams(window.location.search).get('checkout'), []);
  const referralCode = useMemo(() => new URLSearchParams(window.location.search).get('ref')?.toUpperCase(), []);
  const home = `/${lang}/`;

  async function startCheckout() {
    if (!token.trim()) { setState('error'); setMessage(t.missing); return; }
    setState('sending'); setMessage('');
    try {
      const response = await fetch(`${gatewayUrl}/api/billing/checkout-session`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token.trim()}`, 'content-type': 'application/json' },
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

        {referralCode && <Notice tone="success">You’re joining Piggybot through a friend’s referral.</Notice>}

        {result === 'success' && <Notice tone="success"><CheckCircle2 className="h-5 w-5 shrink-0" />{t.success}</Notice>}
        {result === 'cancelled' && <Notice tone="neutral">{t.cancelled}</Notice>}

        <label className="mt-7 block text-sm font-bold">Plan</label>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {plans.map((candidate) => <button key={candidate} type="button" onClick={() => setPlan(candidate)} className={`sketch px-3 py-3 text-sm font-bold transition ${candidate === plan ? 'bg-sunset text-white shadow-paint-sm' : 'bg-paper text-ink-soft hover:bg-sun/30'}`}>{t.plans[candidate]}</button>)}
        </div>

        <label className="mt-7 block text-sm font-bold" htmlFor="activation-token">{t.token}</label>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">{t.tokenHint}</p>
        <textarea id="activation-token" value={token} onChange={(event) => setToken(event.target.value)} className="mt-2 h-28 w-full rounded-md border-2 border-ink/15 bg-paper p-3 text-xs outline-none focus:border-sky-deep" placeholder={t.tokenPlaceholder} autoComplete="off" />

        {state === 'error' && <Notice tone="error">{message}</Notice>}
        <button type="button" disabled={state === 'sending'} onClick={() => void startCheckout()} className="mt-5 flex w-full items-center justify-center gap-2 bg-sky-deep px-5 py-3 font-display text-white sketch shadow-paint transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"><CreditCard className="h-4 w-4" />{state === 'sending' ? t.processing : t.continue}</button>
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-faint"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.secure}</p>
        <a href={home} className="mt-6 inline-block text-sm font-bold text-sky-deep hover:underline">← {t.back}</a>
      </section>
    </main>
  );
}

function Notice({ tone, children }: { tone: 'success' | 'neutral' | 'error'; children: React.ReactNode }) {
  const colors = { success: 'bg-meadow/15 text-meadow-deep', neutral: 'bg-sun/20 text-ink-soft', error: 'bg-sunset/15 text-sunset-deep' };
  return <p className={`mt-5 flex items-start gap-2 rounded-lg p-3 text-sm leading-relaxed ${colors[tone]}`}>{children}</p>;
}
