import { Workflow, Sparkles, LayoutTemplate, Inbox, CalendarDays, Gauge } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { SpritePuff } from "../components/ghibli/Piggy";
import { useT } from "../i18n/LangContext";

const ICONS = [Workflow, Sparkles, LayoutTemplate, Inbox, CalendarDays, Gauge];
const COLORS = ["bg-sky-light", "bg-sun", "bg-piggy-light", "bg-meadow-light", "bg-sky-light", "bg-piggy-light"];

export function Features() {
  const { t } = useT();
  const f = t.features;

  return (
    <section id="features" className="relative bg-paper paper-grain py-20 sm:py-28 overflow-hidden">
      <SpritePuff className="anim-floaty-slow absolute top-16 left-[3%] w-10 opacity-70 hidden lg:block" />
      <SpritePuff className="anim-floaty absolute bottom-20 right-[4%] w-12 opacity-70 hidden lg:block" style={{ animationDelay: "1s" }} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          badge={f.badge}
          title={
            <>
              {f.pre}
              <span className="text-meadow-deep">{f.hi}</span>
            </>
          }
          subtitle={f.subtitle}
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {f.items.map((it, i) => {
            const Icon = ICONS[i];
            return (
              <Reveal key={it.title} delay={(i % 3) * 0.12}>
                <div
                  className={`group relative h-full bg-paper-card sketch p-6 sm:p-7 shadow-paint hover:-translate-y-1.5 hover:shadow-paint-lg transition-all duration-300 ${
                    i % 3 === 0 ? "wobble" : i % 3 === 1 ? "wobble-2" : "wobble-3"
                  }`}
                >
                  <div className={`inline-grid place-items-center w-14 h-14 ${COLORS[i]} sketch blob group-hover:scale-110 group-hover:rotate-6 transition-transform`}>
                    <Icon className="w-7 h-7 text-ink" strokeWidth={2.2} />
                  </div>
                  <h3 className="mt-4 font-display text-xl text-ink">{it.title}</h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">{it.desc}</p>
                  <span className="mt-4 inline-block px-3 py-1 text-xs font-bold text-ink-soft bg-paper-deep sketch-dash wobble-2">
                    {it.tag}
                  </span>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
