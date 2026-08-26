import { useEffect } from "react";

import { LEGAL, type LegalKind } from "../i18n/legal";
import type { Lang } from "../i18n/content";

const BACK: Record<Lang, string> = { zh: "← 回到精灵村", en: "← Back to the village", es: "← Volver a la aldea" };
const CROSS: Record<Lang, { privacy: string; terms: string }> = {
  zh: { privacy: "隐私政策", terms: "服务条款" },
  en: { privacy: "Privacy Policy", terms: "Terms of Service" },
  es: { privacy: "Política de Privacidad", terms: "Términos de Servicio" },
};

function legalPath(lang: Lang, kind: LegalKind) {
  return `${lang === "en" ? "" : `/${lang}`}/${kind}`;
}

export default function Legal({ lang, kind }: { lang: Lang; kind: LegalKind }) {
  const doc = LEGAL[lang][kind];
  const other: LegalKind = kind === "privacy" ? "terms" : "privacy";

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
    document.title = doc.docTitle;
    window.scrollTo(0, 0);
  }, [doc.docTitle, lang]);

  return (
    <main className="paper-grain min-h-screen bg-paper px-4 py-12 text-ink sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href={lang === "en" ? "/" : `/${lang}/`} className="font-hand text-lg text-sky-deep hover:underline">
            {BACK[lang]}
          </a>
          <a href={legalPath(lang, other)} className="font-hand text-lg text-sky-deep hover:underline">
            {CROSS[lang][other]} →
          </a>
        </div>

        <div className="mt-8 bg-paper-card sketch wobble shadow-paint p-6 sm:p-10">
          <h1 className="font-display text-3xl sm:text-4xl">{doc.heading}</h1>
          <p className="mt-2 text-sm font-bold text-ink-faint">{doc.updated}</p>

          {doc.intro.map((p, i) => (
            <p key={i} className="mt-4 leading-relaxed text-ink-soft">{p}</p>
          ))}

          {doc.sections.map((s) => (
            <section key={s.heading} className="mt-8">
              <h2 className="font-display text-xl">{s.heading}</h2>
              {s.paragraphs?.map((p, i) => (
                <p key={i} className="mt-3 leading-relaxed text-ink-soft">{p}</p>
              ))}
              {s.list && (
                <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed text-ink-soft">
                  {s.list.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold">
          <a href={legalPath(lang, "privacy")} className="text-sky-deep hover:underline">{CROSS[lang].privacy}</a>
          <a href={legalPath(lang, "terms")} className="text-sky-deep hover:underline">{CROSS[lang].terms}</a>
          <a href={legalPath(lang === "en" ? "en" : lang, "privacy").replace(/\/(privacy|terms)$/, "/contact")} className="text-sky-deep hover:underline">
            {lang === "zh" ? "联系我们" : lang === "es" ? "Contáctanos" : "Contact us"}
          </a>
        </div>
      </div>
    </main>
  );
}
