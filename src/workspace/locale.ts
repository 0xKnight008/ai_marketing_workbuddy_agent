export type Locale = 'en' | 'es' | 'zh';
function initialLocale(): Locale { try { const value = localStorage.getItem('piggybot.workspace.locale'); return value === 'es' || value === 'zh' ? value : 'en'; } catch { return 'en'; } }
let locale: Locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export function subscribeLocale(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setLocale(value: Locale) { locale = value; try { localStorage.setItem('piggybot.workspace.locale', value); } catch { /* Preference storage is optional. */ } listeners.forEach(listener => listener()); }
