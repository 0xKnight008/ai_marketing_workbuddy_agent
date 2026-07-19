import { Lightbulb, HandHeart, Rocket, Check } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { StarSparkle } from "../components/ghibli/Piggy";
import { useT } from "../i18n/LangContext";

const ICONS = [Lightbulb, HandHeart, Rocket];
const COLORS = ["bg-sky-light", "bg-sun", "bg-piggy-light"];

export function AgentModes() {
  const { t } = useT();
  const m = t.modes;

  return (
    <section id="modes" className="relative py-20 sm:py-28 bg-paper paper-grain overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          badge={m.badge}
          title={
            <>
              {m.pre}
              <span className="text-sunset-deep">{m.hi}</span>
            </>
          }
          subtitle={m.subtitle}
        />

        <div className="mt-14 grid gap-7 md:grid-cols-3 items-stretch">
          {m.items.map((mode, i) => {
            const Icon = ICONS[i];
            const highlight = i === 1;
            return (
              <Reveal key={mode.name} delay={i * 0.13} className="h-full">
                <div
                  className={`relative h-full flex flex-col p-7 sketch shadow-paint transition-all hover:-translate-y-1.5 hover:shadow-paint-lg ${
                    highlight ? "bg-paper-card wobble-2 md:-translate-y-3 md:scale-[1.03] shadow-paint-lg" : "bg-paper-card/80 wobble"
                  }`}
                >
                  {highlight && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-4 py-1.5 bg-sunset text-[#FFF9EC] font-display text-sm sketch wobble-3 shadow-paint-sm whitespace-nowrap">
                      <StarSparkle className="w-3.5 h-3.5 text-sun" /> {m.favorite}
                    </span>
                  )}
                  <p className="font-hand text-xl text-meadow-deep">{mode.level}</p>
                  <span className={`mt-3 grid place-items-center w-14 h-14 ${COLORS[i]} sketch blob`}>
                    <Icon className="w-7 h-7 text-ink" strokeWidth={2.2} />
                  </span>
                  <h3 className="mt-4 font-display text-2xl text-ink">{mode.name}</h3>
                  <p className="mt-1 font-display text-sunset-deep">{mode.slogan}</p>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-soft flex-1">{mode.desc}</p>
                  <ul className="mt-4 space-y-2">
                    {mode.points.map((p) => (
                      <li key={p} className="flex items-center gap-2 text-sm font-bold text-ink">
                        <Check className="w-4 h-4 text-meadow-deep shrink-0" strokeWidth={3} />
                        {p}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-5 pt-4 border-t-2 border-dashed border-ink/15 text-[13px] font-bold text-ink-faint">{mode.fit}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={0.2} className="mt-10 text-center">
          <p className="inline-block px-6 py-3 bg-paper-deep sketch-dash wobble-3 text-ink-soft font-bold text-sm">
            {m.note}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
