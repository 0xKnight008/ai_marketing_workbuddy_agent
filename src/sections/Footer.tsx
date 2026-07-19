import { useState } from "react";
import { Send, Check } from "lucide-react";
import { Piggy, SpritePuff, StarSparkle } from "../components/ghibli/Piggy";
import { Moon, NightHills, Fireflies, TwinkleStar } from "../components/ghibli/Scenery";
import { Reveal } from "../components/Reveal";
import { useT } from "../i18n/LangContext";

const STARS = [
  { left: "6%", top: "10%" }, { left: "14%", top: "26%" }, { left: "23%", top: "8%" },
  { left: "33%", top: "20%" }, { left: "44%", top: "6%" }, { left: "55%", top: "16%" },
  { left: "66%", top: "9%" }, { left: "76%", top: "24%" }, { left: "88%", top: "12%" },
  { left: "94%", top: "30%" }, { left: "50%", top: "30%" }, { left: "27%", top: "34%" },
];

export function Footer() {
  const { t } = useT();
  const f = t.footer;
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  return (
    <footer className="relative bg-night overflow-hidden">
      {/* 星空 */}
      <div className="absolute inset-0 bg-gradient-to-b from-night-deep via-night to-[#24345C]" aria-hidden />
      {STARS.map((s, i) => (
        <TwinkleStar key={i} style={{ ...s, animationDelay: `${(i * 0.5) % 3}s` }} />
      ))}
      <Moon className="absolute top-10 right-[10%] w-16 sm:w-24 opacity-95" />
      <Fireflies count={14} />

      {/* 睡觉的精灵 */}
      <div className="absolute bottom-40 left-[6%] w-16 sm:w-20 opacity-95 hidden md:block anim-floaty-slow" aria-hidden>
        <SpritePuff className="w-full h-auto" />
      </div>
      <div className="absolute bottom-44 right-[14%] w-12 hidden lg:block anim-floaty" aria-hidden>
        <SpritePuff className="w-full h-auto" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-24 sm:pt-32 pb-10">
        {/* 最终 CTA */}
        <Reveal className="text-center max-w-2xl mx-auto">
          <div className="mx-auto w-24 sm:w-28 anim-floaty">
            <Piggy className="w-full h-auto drop-shadow-xl" />
          </div>
          <h2 className="mt-6 font-display text-3xl sm:text-5xl text-[#FDF6E4] leading-snug">
            {f.l1}
            <br />
            {f.l2pre}
            <span className="text-sun">{f.l2hi}</span>
          </h2>
          <p className="font-hand text-2xl text-sky mt-2 -rotate-1">{f.tagline}</p>
          <p className="mt-4 text-[#C8CFDF] leading-relaxed">{f.sub}</p>

          <form
            className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) setDone(true);
            }}
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={f.placeholder}
              aria-label={f.emailLabel}
              className="flex-1 px-5 py-3.5 bg-[#FDF6E4] text-ink font-bold sketch wobble-3 placeholder:text-ink-faint focus:outline-none focus:ring-4 focus:ring-sun/40"
            />
            <button
              type="submit"
              className="inline-flex justify-center items-center gap-2 px-6 py-3.5 bg-sunset text-[#FFF9EC] font-display sketch wobble shadow-paint hover:-translate-y-0.5 hover:shadow-paint-lg transition-all"
            >
              {done ? <Check className="w-5 h-5" /> : <Send className="w-5 h-5" />}
              {done ? f.buttonDone : f.button}
            </button>
          </form>
          {done && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sun font-bold text-sm">
              <StarSparkle className="w-4 h-4 text-sun" />
              {f.doneNote}
            </p>
          )}
        </Reveal>

        {/* 链接列 */}
        <div className="mt-20 pt-12 border-t-2 border-dashed border-[#FDF6E4]/15 grid grid-cols-2 md:grid-cols-4 gap-8">
          {f.columns.map((col) => (
            <div key={col.title}>
              <h4 className="font-display text-[#F6E7C1] text-lg">{col.title}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#top" className="text-sm text-[#A8B4CC] hover:text-sun transition-colors font-bold">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 夜丘 */}
        <div className="mt-14 -mx-4 sm:-mx-6">
          <NightHills className="w-full h-36 sm:h-44" />
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#8B97B3]">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7"><Piggy className="w-full h-full" flying={false} /></span>
            <span className="font-display text-[#F6E7C1]">Piggybot</span>
            <span>{f.copyright}</span>
          </div>
          <p className="font-hand text-lg text-[#A8B4CC]">{f.madeWith}</p>
        </div>
      </div>
    </footer>
  );
}
