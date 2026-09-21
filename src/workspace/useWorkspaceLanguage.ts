import { useSyncExternalStore } from 'react';
import { getLocale, setLocale, subscribeLocale } from './locale';
export function useWorkspaceLanguage() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  return { locale, setLocale, w: (en: string, es: string, zh: string) => locale === 'es' ? es : locale === 'zh' ? zh : en };
}
