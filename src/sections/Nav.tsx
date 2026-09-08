import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X, Sparkles } from "lucide-react";
import { Piggy } from "../components/ghibli/Piggy";
import { useT } from "../i18n/LangContext";
import type { Lang } from "../i18n/content";

const LANGS: { code: Lang; label: string }[] = [
  { code: "zh", label: "中" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
];

function FeaturesMenu({ label, mobile = false, onNavigate }: { label: string; mobile?: boolean; onNavigate?: () => void }) {
  const { t } = useT();
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return (
    <details
      ref={details}
      className="group/features relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-1.5 font-bold text-ink-soft hover:text-ink hover:bg-paper-deep/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-meadow [&::-webkit-details-marker]:hidden ${mobile ? "px-3 py-2.5 rounded-xl" : "px-3 py-2 text-[15px] rounded-full whitespace-nowrap"}`}>
        {label}
        <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open/features:rotate-180" />
      </summary>
      <div className={mobile ? "ml-3 border-l-2 border-meadow/25 pl-2" : "absolute left-0 top-full z-50 mt-2 w-56 rounded-2xl border-2 border-ink/15 bg-paper-card p-2 shadow-paint"}>
        {[{ label: t.nav.featuresOverview, href: "#features" }, ...t.nav.featureLinks].map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={() => {
              if (details.current) details.current.open = false;
              onNavigate?.();
            }}
            className="block rounded-xl px-3 py-2.5 text-[15px] font-bold text-ink-soft hover:bg-paper-deep hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-meadow"
          >
            {link.label}
          </a>
        ))}
      </div>
    </details>
  );
}

/** Route every locale to its own static entry point. */
function langHref(current: Lang, target: Lang): string {
  if (current === target) return "#top";
  const segs = window.location.pathname.split("/").filter(Boolean);
  const isLocalePath = segs.some((segment) => segment === "zh" || segment === "en" || segment === "es");
  return isLocalePath ? `../${target}/` : `./${target}/`;
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
          <nav className="hidden xl:flex items-center gap-1" aria-label={t.nav.menu}>
            {t.nav.links.map((l) => l.href === "#features" ? (
              <FeaturesMenu key={l.href} label={l.label} />
            ) : (
              <a
                key={l.href}
                href={l.href}
                className="px-3 py-2 text-[15px] font-bold text-ink-soft hover:text-ink hover:bg-paper-deep/70 rounded-full transition-colors whitespace-nowrap"
              >
                {l.label}
              </a>
            ))}
            <a
              href="/login"
              className="px-3 py-2 text-[15px] font-bold text-ink-soft hover:text-ink hover:bg-paper-deep/70 rounded-full transition-colors whitespace-nowrap"
            >
              {t.nav.console}
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-3">
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
              type="button"
              className="xl:hidden p-2 sketch wobble-3 bg-paper-card text-ink"
              onClick={() => setOpen(!open)}
              aria-label={t.nav.menu}
              aria-expanded={open}
              aria-controls="mobile-navigation"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* 移动端菜单 */}
        {open && (
          <nav id="mobile-navigation" aria-label={t.nav.menu} className="xl:hidden mt-3 max-h-[calc(100dvh-6rem)] overflow-y-auto p-4 bg-paper-card sketch wobble shadow-paint flex flex-col gap-1">
            {t.nav.links.map((l) => l.href === "#features" ? (
              <FeaturesMenu key={l.href} label={l.label} mobile onNavigate={() => setOpen(false)} />
            ) : (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="px-3 py-2.5 font-bold text-ink-soft hover:text-ink hover:bg-paper-deep rounded-xl"
              >
                {l.label}
              </a>
            ))}
            <a
              href="/login"
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 font-bold text-ink-soft hover:text-ink hover:bg-paper-deep rounded-xl"
            >
              {t.nav.console}
            </a>
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
