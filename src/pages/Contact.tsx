import { useEffect } from 'react';

import { ContactSupport } from '../components/ContactSupport';
import type { Lang } from '../i18n/content';

export default function Contact({ lang }: { lang: Lang }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return <main className="paper-grain min-h-screen bg-paper px-4 py-12 text-ink sm:px-6"><div className="mx-auto max-w-lg"><a href={lang === 'en' ? '/' : `/${lang}/`} className="font-hand text-lg text-sky-deep hover:underline">← Piggybot</a><div className="mt-8"><ContactSupport lang={lang} embedded /></div></div></main>;
}
