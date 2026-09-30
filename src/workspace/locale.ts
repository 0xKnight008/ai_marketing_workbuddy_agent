export type Locale = 'en' | 'es' | 'zh';
function initialLocale(): Locale { try { const requested = new URLSearchParams(location.search).get('locale'); if (requested === 'en' || requested === 'zh' || requested === 'es') return requested; const value = localStorage.getItem('piggybot.workspace.locale'); return value === 'es' || value === 'zh' ? value : 'en'; } catch { return 'en'; } }
let locale: Locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export function subscribeLocale(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setLocale(value: Locale) { locale = value; try { const url = new URL(location.href); if (url.searchParams.has('locale')) { url.searchParams.set('locale', value); history.replaceState(null, '', url); } } catch { /* URL preferences are optional. */ } try { localStorage.setItem('piggybot.workspace.locale', value); } catch { /* Preference storage is optional. */ } listeners.forEach(listener => listener()); }
