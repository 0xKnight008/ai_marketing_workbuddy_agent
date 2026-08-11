import { useState, type FormEvent } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';

import type { Lang } from '../i18n/content';

type SupportState = 'idle' | 'sending' | 'success' | 'error';

const COPY: Record<Lang, {
  button: string; title: string; subtitle: string; email: string; name: string; optional: string; category: string; message: string;
  billing: string; bug: string; feature: string; other: string; send: string; sending: string; reply: string; error: string; close: string; ticket: string;
}> = {
  zh: { button: '联系我们', title: '联系支持团队', subtitle: '告诉我们遇到的问题，我们会在 1 个工作日内回复。', email: '邮箱', name: '姓名', optional: '选填', category: '问题类型', message: '描述你的问题', billing: '账单与付款', bug: '故障 / Bug', feature: '功能建议', other: '其他', send: '发送消息', sending: '正在发送…', reply: '我们会在 1 个工作日内回复。', error: '暂时无法发送，请稍后重试。', close: '关闭', ticket: '工单号' },
  en: { button: 'Contact us', title: 'Contact support', subtitle: 'Tell us what happened and we will reply within one business day.', email: 'Email', name: 'Name', optional: 'optional', category: 'Category', message: 'How can we help?', billing: 'Billing', bug: 'Bug', feature: 'Feature request', other: 'Other', send: 'Send message', sending: 'Sending…', reply: 'We will reply within one business day.', error: 'We could not send your message. Please try again.', close: 'Close', ticket: 'Ticket' },
  es: { button: 'Contáctanos', title: 'Contacta con soporte', subtitle: 'Cuéntanos qué ha ocurrido y responderemos en un día laborable.', email: 'Correo electrónico', name: 'Nombre', optional: 'opcional', category: 'Categoría', message: '¿Cómo podemos ayudarte?', billing: 'Facturación', bug: 'Error', feature: 'Solicitud de función', other: 'Otro', send: 'Enviar mensaje', sending: 'Enviando…', reply: 'Responderemos en un día laborable.', error: 'No pudimos enviar tu mensaje. Inténtalo de nuevo.', close: 'Cerrar', ticket: 'Ticket' },
};

export function ContactSupport({ lang, embedded = false }: { lang: Lang; embedded?: boolean }) {
  const copy = COPY[lang];
  const [open, setOpen] = useState(embedded);
  const [state, setState] = useState<SupportState>('idle');
  const [ticketId, setTicketId] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState('sending');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'), name: form.get('name'), category: form.get('category'), message: form.get('message'), website: form.get('website'),
          locale: lang, pageUrl: window.location.href,
        }),
      });
      const result = await response.json().catch(() => ({})) as { ticketId?: string };
      if (!response.ok || !result.ticketId) throw new Error('feedback_not_accepted');
      setTicketId(result.ticketId);
      setState('success');
    } catch {
      setState('error');
    }
  }

  function resetAndClose() { setOpen(false); setState('idle'); setTicketId(''); }

  return (
    <>
      {!embedded && <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-sunset px-4 py-3 font-display text-sm text-[#FFF9EC] shadow-paint transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-sun/60" aria-haspopup="dialog">
        <MessageCircle size={19} aria-hidden />{copy.button}
      </button>}
      {open && <div className={embedded ? '' : 'fixed inset-0 z-50 flex items-end justify-center bg-night/40 p-4 sm:items-center'} role={embedded ? undefined : 'presentation'} onMouseDown={embedded ? undefined : (event) => { if (event.target === event.currentTarget) resetAndClose(); }}>
        <section role="dialog" aria-modal={!embedded || undefined} aria-labelledby="contact-support-title" className="w-full max-w-lg rounded-2xl border-2 border-ink/20 bg-paper-card p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div><h1 id="contact-support-title" className="font-display text-2xl text-ink">{copy.title}</h1><p className="mt-1 text-sm text-ink-soft">{copy.subtitle}</p></div>
            {!embedded && <button type="button" onClick={resetAndClose} className="rounded-md p-2 text-ink-soft hover:bg-paper hover:text-ink" aria-label={copy.close}><X size={20} /></button>}
          </div>
          {state === 'success' ? <div className="mt-6 rounded-xl bg-meadow/15 p-5 text-sm text-ink"><p className="font-semibold">{copy.ticket}: {ticketId}</p><p className="mt-2">{copy.reply}</p></div> : <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)} noValidate>
            <label className="block text-sm font-medium">{copy.email}<input required type="email" name="email" autoComplete="email" className="mt-1.5 w-full rounded-lg border border-ink/20 bg-paper px-3 py-2.5 outline-none focus:ring-2 focus:ring-sky" /></label>
            <label className="block text-sm font-medium">{copy.name} <span className="font-normal text-ink-faint">({copy.optional})</span><input name="name" autoComplete="name" maxLength={120} className="mt-1.5 w-full rounded-lg border border-ink/20 bg-paper px-3 py-2.5 outline-none focus:ring-2 focus:ring-sky" /></label>
            <label className="block text-sm font-medium">{copy.category}<select name="category" defaultValue="other" className="mt-1.5 w-full rounded-lg border border-ink/20 bg-paper px-3 py-2.5 outline-none focus:ring-2 focus:ring-sky"><option value="billing">{copy.billing}</option><option value="bug">{copy.bug}</option><option value="feature">{copy.feature}</option><option value="other">{copy.other}</option></select></label>
            <label className="block text-sm font-medium">{copy.message}<textarea required name="message" maxLength={2000} rows={5} className="mt-1.5 w-full resize-y rounded-lg border border-ink/20 bg-paper px-3 py-2.5 outline-none focus:ring-2 focus:ring-sky" /></label>
            <label className="sr-only" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
            {state === 'error' && <p className="text-sm font-medium text-red-700" role="alert">{copy.error}</p>}
            <button disabled={state === 'sending'} className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-deep px-4 py-3 font-medium text-white transition hover:bg-sky-deep/90 disabled:opacity-60"><Send size={17} />{state === 'sending' ? copy.sending : copy.send}</button>
          </form>}
        </section>
      </div>}
    </>
  );
}
