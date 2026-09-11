import { ArrowRight, Palette, Store, Users } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { SpritePuff, StarSparkle } from "../components/ghibli/Piggy";
import { GrassTuft, Flower } from "../components/ghibli/Scenery";
import { useT } from "../i18n/LangContext";

const ICONS = [Palette, Store, Users];
const ICON_BG = ["bg-sky-light", "bg-sun", "bg-meadow-light"];
const TAG_ROTATION = ["-rotate-2", "rotate-2", "-rotate-1"];
const WOBBLE = ["wobble", "wobble-2", "wobble-3"];

export function Audiences() {
  const { t } = useT();
  const a = t.audiences;

  return (
    <section id="audiences" className="relative py-20 sm:py-28 bg-gradient-to-b from-paper via-meadow-light/20 to-paper overflow-hidden">
      <SpritePuff className="anim-floaty absolute top-24 right-[4%] w-10 opacity-60 hidden lg:block" />
      <SpritePuff className="anim-floaty-slow absolute bottom-28 left-[3%] w-12 opacity-60 hidden lg:block" style={{ animationDelay: "1.4s" }} />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          badge={a.badge}
          title={
            <>
              {a.pre}
              <span className="text-meadow-deep">{a.hi}</span>
            </>
          }
          subtitle={a.subtitle}
        />

        {/* 进村小路：蜿蜒的虚线小径 */}
        <Reveal delay={0.08} className="mt-10 hidden md:block">
          <svg viewBox="0 0 1200 90" className="mx-auto w-full max-w-4xl" fill="none" aria-hidden>
            <path
              d="M20 62 C 220 12, 420 84, 620 46 S 1010 18, 1180 54"
              stroke="#4A3F35"
              strokeWidth="2.5"
              strokeDasharray="1 12"
              strokeLinecap="round"
              opacity="0.35"
            />
            <circle cx="620" cy="46" r="5" fill="#F4C95D" stroke="#4A3F35" strokeWidth="2" />
          </svg>
        </Reveal>

        <div className="mt-8 md:mt-4 grid gap-7 md:grid-cols-3 items-start max-w-6xl mx-auto">
          {a.items.map((item, i) => {
            const Icon = ICONS[i];
            return (
              <Reveal key={item.persona} delay={i * 0.12} className={`h-full ${i === 1 ? "md:mt-10" : ""}`}>
                <div
                  className={`group relative h-full flex flex-col bg-paper-card sketch ${WOBBLE[i]} shadow-paint p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-paint-lg`}
                >
                  <span
                    className={`absolute -top-3.5 left-6 px-3 py-0.5 bg-paper-deep font-hand text-xl text-ink sketch-soft ${TAG_ROTATION[i]}`}
                  >
                    {item.persona}
                  </span>
                  <div className={`mt-4 inline-grid place-items-center w-14 h-14 ${ICON_BG[i]} sketch blob group-hover:scale-110 group-hover:rotate-6 transition-transform`}>
                    <Icon className="w-7 h-7 text-ink" strokeWidth={2.2} />
                  </div>
                  <h3 className="mt-4 font-display text-2xl text-ink">{item.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{item.desc}</p>
                  <ul className="mt-4 pt-4 border-t-2 border-dashed border-ink/15 space-y-2.5 flex-1">
                    {item.points.map((point) => (
                      <li key={point} className="flex items-start gap-2 text-sm text-ink-soft">
                        <StarSparkle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sun" />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={item.href}
                    className="mt-5 inline-flex w-fit items-center gap-1.5 font-bold text-sky-deep border-b-2 border-dotted border-sky-deep/50 pb-0.5 transition-all hover:gap-2.5 hover:text-ink hover:border-ink/60"
                  >
                    {item.cta}
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* 路边的花草 */}
        <div className="pointer-events-none mt-12 flex justify-between px-[6%]" aria-hidden>
          <div className="flex items-end gap-3">
            <GrassTuft className="w-9 text-meadow-dark" />
            <Flower className="w-5 mb-1" color="#FFFDF6" />
          </div>
          <div className="flex items-end gap-3">
            <Flower className="w-5 mb-1 hidden sm:block" color="#F6AEBB" />
            <GrassTuft className="w-9 text-meadow-dark" delay={0.9} />
          </div>
        </div>
      </div>
    </section>
  );
}
