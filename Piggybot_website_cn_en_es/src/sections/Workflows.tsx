import { PenLine, MessagesSquare, FileBarChart2, ShieldCheck, MoveRight, Coins } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { GrassTuft } from "../components/ghibli/Scenery";
import { useT } from "../i18n/LangContext";

const ICONS = [PenLine, MessagesSquare, FileBarChart2, ShieldCheck];
const COLORS = ["bg-piggy-light", "bg-sky-light", "bg-sun", "bg-meadow-light"];

const isAI = (s: string) => /\bAI\b|\bIA\b/.test(s);
const isGate = (s: string) => /审批|条件|approval|approve|condition|aprobación|aprobar|condición/i.test(s);

export function Workflows() {
  const { t } = useT();
  const w = t.workflows;

  return (
    <section id="workflows" className="relative py-20 sm:py-28 bg-gradient-to-b from-paper via-meadow-light/35 to-paper overflow-hidden">
      <GrassTuft className="absolute bottom-6 left-[5%] w-10 text-meadow/60 hidden lg:block" />
      <GrassTuft className="absolute bottom-6 right-[6%] w-8 text-meadow/60 hidden lg:block" delay={0.9} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          badge={w.badge}
          title={
            <>
              {w.pre}
              <span className="text-meadow-deep">{w.hi}</span>
            </>
          }
          subtitle={w.subtitle}
        />

        <div className="mt-14 grid gap-7 lg:grid-cols-2">
          {w.items.map((wf, i) => {
            const Icon = ICONS[i];
            return (
              <Reveal key={wf.title} delay={(i % 2) * 0.12}>
                <article
                  className={`relative h-full bg-paper-card sketch p-6 sm:p-8 shadow-paint hover:shadow-paint-lg hover:-translate-y-1 transition-all ${
                    i % 2 === 0 ? "wobble" : "wobble-2"
                  } ${i === 1 ? "tape" : ""}`}
                >
                  <div className="flex items-start gap-4">
                    <span className={`grid place-items-center w-14 h-14 ${COLORS[i]} sketch blob shrink-0`}>
                      <Icon className="w-7 h-7 text-ink" strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-hand text-xl text-sunset-deep leading-none">{wf.scene}</p>
                      <h3 className="mt-1 font-display text-2xl text-ink">{wf.title}</h3>
                    </div>
                    <span className="ml-auto shrink-0 px-3 py-1 text-xs font-bold bg-paper-deep sketch-dash wobble-3 text-ink-soft">
                      {wf.persona}
                    </span>
                  </div>

                  <p className="mt-4 font-hand text-2xl text-ink-soft">{wf.quote}</p>

                  {/* 步骤管线 */}
                  <div className="mt-5 flex flex-wrap items-center gap-y-2.5">
                    {wf.steps.map((s, j) => (
                      <span key={j} className="flex items-center">
                        <span
                          className={`px-3 py-1.5 text-[13px] font-bold sketch-soft whitespace-nowrap ${
                            isAI(s) ? "bg-sun/70 text-ink" : isGate(s) ? "bg-piggy-light text-ink" : "bg-paper text-ink"
                          } ${j % 2 === 0 ? "wobble-3" : "wobble-2"}`}
                        >
                          {s}
                        </span>
                        {j < wf.steps.length - 1 && <MoveRight className="w-4 h-4 mx-1 text-ink-faint shrink-0" />}
                      </span>
                    ))}
                  </div>

                  <div className="mt-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ink text-sun font-bold text-[13px] wobble-2">
                    <Coins className="w-4 h-4" />
                    {wf.cost}
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
