import { useEffect, useState, type ReactNode } from 'react';

const gateway = import.meta.env.VITE_GATEWAY_URL?.trim().replace(/\/+$/, '') || (import.meta.env.DEV ? 'http://localhost:4100' : '');

export default function AdminEmailGate({ children }: { children: (email: string, logout: () => void, expired: () => void) => ReactNode }) {
  const [email, setEmail] = useState('');
  const [principal, setPrincipal] = useState('');
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const expired = () => { setPrincipal(''); setMessage('Your admin session has expired. Please sign in again.'); };
  async function profile() {
    const response = await fetch(`${gateway}/api/admin/auth/session`, { credentials: 'include', cache: 'no-store' });
    if (response.ok) setPrincipal((await response.json()).email);
    else if (response.status !== 401) throw new Error('Admin sign-in is temporarily unavailable.');
  }
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('admin_ticket');
    if (value) {
      setTicket(value);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    document.title = 'Piggybot admin sign-in';
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.appendChild(meta);
    void profile().catch(() => setMessage('Admin sign-in is temporarily unavailable.')).finally(() => setBusy(false));
    return () => meta.remove();
  }, []);
  async function action(kind: 'request' | 'exchange' | 'logout') {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${gateway}/api/admin/auth/${kind}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'request' ? { email } : kind === 'exchange' ? { ticket } : {}) });
      if (!response.ok) throw new Error(kind === 'exchange' ? 'This sign-in link is invalid or expired. Request a new link.' : 'Unable to complete the request. Please try again.');
      if (kind === 'request') setMessage('If this email is authorized, a sign-in link will be sent. Check your inbox and spam folder.');
      if (kind === 'exchange') { setTicket(''); await profile(); }
      if (kind === 'logout') { setPrincipal(''); setTicket(''); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request failed.'); }
    finally { setBusy(false); }
  }
  if (principal && !ticket) return <>{message && <p role="alert">{message}</p>}{children(principal, () => void action('logout'), expired)}</>;
  return <main className="paper-grain flex min-h-screen items-center justify-center bg-paper p-6 text-ink"><section className="w-full max-w-md rounded-xl border border-ink/20 bg-paper-card p-8">
    <p className="font-hand text-xl text-sunset">Piggybot Platform Admin</p><h1 className="my-4 font-display text-3xl">Secure admin sign-in</h1>
    <p className="mb-6 text-sm text-ink-soft">Access is limited to authorized administrators. Links expire after 10 minutes and can only be used once.</p>
    {ticket ? <><button disabled={busy} onClick={() => void action('exchange')} className="w-full rounded bg-sky-deep p-3 text-white disabled:opacity-50">Continue sign-in</button><button onClick={() => setTicket('')} className="mt-4 text-sm underline">Request a different link</button></> : <form onSubmit={event => { event.preventDefault(); void action('request'); }}>
      <label className="text-sm">Administrator email<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="my-3 w-full rounded border border-ink/20 bg-paper p-3" /></label>
      <button disabled={busy} className="w-full rounded bg-sky-deep p-3 text-white disabled:opacity-50">{busy ? 'Please wait…' : 'Email sign-in link'}</button>
    </form>}
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}<a href="/" className="mt-6 block text-sm underline">Back to site</a>
  </section></main>;
}
