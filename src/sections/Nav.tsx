import { useEffect, useState } from "react";
import { Menu, X, Sparkles } from "lucide-react";
import { Piggy } from "../components/ghibli/Piggy";
import { useT } from "../i18n/LangContext";
import type { Lang } from "../i18n/content";

const LANGS: { code: Lang; label: string }[] = [
  { code: "zh", label: "中" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
];

/** 相对路径跳转，兼容任意部署子路径（含 /en /es 子目录） */
function langHref(current: Lang, target: Lang): string {
  if (current === target) return "#top";
  if (current === "zh") return `./${target}/`;
  return target === "zh" ? "../" : `../${target}/`;
}

export function Nav() {
  const { lang, t } = useT();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-paper/95 backdrop-blur-sm shadow-paint-sm" : "bg-transparent"
      }`}
    >
      <div className={`mx-auto max-w-7xl px-4 sm:px-6 ${scrolled ? "py-2.5" : "py-4"} transition-all`}>
        <div className="flex items-center justify-between gap-4">
          {/* Logo */}
          <a href="#top" className="flex items-center gap-2.5 group shrink-0">
            <span className="w-11 h-11 grid place-items-center group-hover:-translate-y-0.5 transition-transform">
              <Piggy className="w-11 h-11 drop-shadow-sm" />
            </span>
            <span className="font-display text-2xl text-ink leading-none whitespace-nowrap">
              Piggybot
              <span className="ml-1.5 align-middle inline-block px-1.5 py-0.5 text-[11px] bg-sun text-ink sketch wobble-2 -rotate-2">
                .me
              </span>
            </span>
          </a>

          {/* 桌面导航 */}
          <nav className="hidden lg:flex items-center gap-1">
            {t.nav.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="px-3 py-2 text-[15px] font-bold text-ink-soft hover:text-ink hover:bg-paper-deep/70 rounded-full transition-colors whitespace-nowrap"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {/* 语言切换 */}
            <div className="hidden sm:flex items-center gap-0.5 p-1 bg-paper-card/85 sketch-soft rounded-full">
              {LANGS.map((l) => (
                <a
                  key={l.code}
                  href={langHref(lang, l.code)}
                  aria-current={lang === l.code ? "page" : undefined}
                  className={`px-2.5 py-1 text-xs font-black rounded-full transition-colors ${
                    lang === l.code ? "bg-meadow text-[#FFF9EC]" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {l.label}
                </a>
              ))}
            </div>
            <a
              href="#pricing"
              className="hidden sm:inline-flex items-center gap-1.5 px-5 py-2.5 bg-sunset text-[#FFF9EC] font-display text-base sketch wobble shadow-paint hover:-translate-y-0.5 hover:shadow-paint-lg transition-all whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" />
              {t.nav.cta}
            </a>
            <button
              className="lg:hidden p-2 sketch wobble-3 bg-paper-card text-ink"
              onClick={() => setOpen(!open)}
              aria-label="menu"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* 移动端菜单 */}
        {open && (
          <nav className="lg:hidden mt-3 p-4 bg-paper-card sketch wobble shadow-paint flex flex-col gap-1">
            {t.nav.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="px-3 py-2.5 font-bold text-ink-soft hover:text-ink hover:bg-paper-deep rounded-xl"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex items-center gap-2 px-3">
              {LANGS.map((l) => (
                <a
                  key={l.code}
                  href={langHref(lang, l.code)}
                  aria-current={lang === l.code ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`px-3 py-1.5 text-sm font-black rounded-full sketch-soft ${
                    lang === l.code ? "bg-meadow text-[#FFF9EC]" : "text-ink-soft bg-paper"
                  }`}
                >
                  {l.label}
                </a>
              ))}
            </div>
            <a
              href="#pricing"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex justify-center items-center gap-1.5 px-5 py-2.5 bg-sunset text-[#FFF9EC] font-display sketch wobble shadow-paint"
            >
              <Sparkles className="w-4 h-4" />
              {t.nav.cta}
            </a>
          </nav>
        )}
      </div>
    </header>
  );
}
