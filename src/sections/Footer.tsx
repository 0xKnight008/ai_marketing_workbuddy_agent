import { Piggy, SpritePuff } from "../components/ghibli/Piggy";
import { Moon, NightHills, Fireflies, TwinkleStar } from "../components/ghibli/Scenery";
import { Reveal } from "../components/Reveal";
import { useT } from "../i18n/LangContext";
import { GOOGLE_FORM_EMBED_URL } from "../config";

const STARS = [
  { left: "6%", top: "10%" }, { left: "14%", top: "26%" }, { left: "23%", top: "8%" },
  { left: "33%", top: "20%" }, { left: "44%", top: "6%" }, { left: "55%", top: "16%" },
  { left: "66%", top: "9%" }, { left: "76%", top: "24%" }, { left: "88%", top: "12%" },
  { left: "94%", top: "30%" }, { left: "50%", top: "30%" }, { left: "27%", top: "34%" },
];

export function Footer() {
  const { t } = useT();
  const f = t.footer;
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

          <iframe
            title={f.signupFormTitle}
            src={GOOGLE_FORM_EMBED_URL}
            className="mt-8 h-[409px] w-full max-w-[640px] rounded-xl bg-paper-card"
            style={{ border: 0 }}
          >
            正在加载…
          </iframe>
        </Reveal>

        {/* 链接列 */}
        <div className="mt-20 pt-12 border-t-2 border-dashed border-[#FDF6E4]/15 grid grid-cols-2 md:grid-cols-3 gap-8 max-w-3xl">
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
