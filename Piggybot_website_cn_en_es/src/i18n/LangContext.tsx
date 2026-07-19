import React, { createContext, useContext } from "react";
import { CONTENT } from "./content";
import type { Lang, SiteContent } from "./content";

const LangContext = createContext<{ lang: Lang; t: SiteContent }>({ lang: "zh", t: CONTENT.zh });

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={{ lang, t: CONTENT[lang] }}>{children}</LangContext.Provider>;
}

export function useT() {
  return useContext(LangContext);
}
