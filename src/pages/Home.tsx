import { useEffect } from "react";
import { LangProvider } from "../i18n/LangContext";
import { CONTENT, type Lang } from "../i18n/content";
import { Nav } from "../sections/Nav";
import { Hero } from "../sections/Hero";
import { Marquee } from "../sections/Marquee";
import { Features } from "../sections/Features";
import { CopilotDemo } from "../sections/CopilotDemo";
import { Workflows } from "../sections/Workflows";
import { AgentModes } from "../sections/AgentModes";
import { Governance } from "../sections/Governance";
import { Integrations } from "../sections/Integrations";
import { Pricing } from "../sections/Pricing";
import { Faq } from "../sections/Faq";
import { Footer } from "../sections/Footer";

function setMeta(selector: string, content: string) {
  const element = document.head.querySelector<HTMLMetaElement>(selector);
  if (element) element.content = content;
}

export default function Home({ lang }: { lang: Lang }) {
  useEffect(() => {
    const content = CONTENT[lang];
    document.documentElement.lang = content.htmlLang;
    document.title = content.docTitle;
    setMeta('meta[name="description"]', content.metaDescription);
    setMeta('meta[property="og:title"]', content.docTitle);
    setMeta('meta[property="og:description"]', content.ogDescription);
    setMeta('meta[property="og:url"]', `${window.location.origin}${window.location.pathname}`);
    window.scrollTo(0, 0);
  }, [lang]);

  return (
    <LangProvider lang={lang}>
      <div className="min-h-screen bg-paper text-ink antialiased">
        <Nav />
        <main>
          <Hero />
          <Marquee />
          <Features />
          <CopilotDemo />
          <Workflows />
          <AgentModes />
          <Governance />
          <Integrations />
          <Pricing />
          <Faq />
        </main>
        <Footer />
      </div>
    </LangProvider>
  );
}
