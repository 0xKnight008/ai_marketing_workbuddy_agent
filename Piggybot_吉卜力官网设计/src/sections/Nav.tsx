import { useEffect, useState } from "react";
import { Menu, X, Sparkles } from "lucide-react";
import { Piggy } from "../components/ghibli/Piggy";

const LINKS = [
  { label: "精灵能力", href: "#features" },
  { label: "咒语演示", href: "#copilot" },
  { label: "工作流剧场", href: "#workflows" },
  { label: "修行模式", href: "#modes" },
  { label: "安心结界", href: "#governance" },
  { label: "精灵集市", href: "#integrations" },
  { label: "价目灯笼", href: "#pricing" },
];

export function Nav() {
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
          <a href="#top" className="flex items-center gap-2.5 group">
            <span className="w-11 h-11 grid place-items-center group-hover:-translate-y-0.5 transition-transform">
              <Piggy className="w-11 h-11 drop-shadow-sm" />
            </span>
            <span className="font-display text-2xl text-ink leading-none">
              Piggybot
              <span className="ml-1.5 align-middle inline-block px-1.5 py-0.5 text-[11px] bg-sun text-ink sketch wobble-2 -rotate-2">
                .me
              </span>
            </span>
          </a>

          {/* 桌面导航 */}
          <nav className="hidden lg:flex items-center gap-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="px-3 py-2 text-[15px] font-bold text-ink-soft hover:text-ink hover:bg-paper-deep/70 rounded-full transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="#pricing"
              className="hidden sm:inline-flex items-center gap-1.5 px-5 py-2.5 bg-sunset text-[#FFF9EC] font-display text-base sketch wobble shadow-paint hover:-translate-y-0.5 hover:shadow-paint-lg transition-all"
            >
              <Sparkles className="w-4 h-4" />
              免费召唤
            </a>
            <button
              className="lg:hidden p-2 sketch wobble-3 bg-paper-card text-ink"
              onClick={() => setOpen(!open)}
              aria-label="菜单"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* 移动端菜单 */}
        {open && (
          <nav className="lg:hidden mt-3 p-4 bg-paper-card sketch wobble shadow-paint flex flex-col gap-1">
            {LINKS.map((l) => (
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
              href="#pricing"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex justify-center items-center gap-1.5 px-5 py-2.5 bg-sunset text-[#FFF9EC] font-display sketch wobble shadow-paint"
            >
              <Sparkles className="w-4 h-4" />
              免费召唤
            </a>
          </nav>
        )}
      </div>
    </header>
  );
}
