import { Check, Coins, Sparkles } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { SpritePuff } from "../components/ghibli/Piggy";
import { useT } from "../i18n/LangContext";

/** 手绘小灯笼 */
function Lantern({ className = "", style, delay = 0 }: { className?: string; style?: React.CSSProperties; delay?: number }) {
  return (
    <svg
      viewBox="0 0 60 96"
      className={`anim-sway ${className}`}
      style={{ transformOrigin: "top center", animationDelay: `${delay}s`, animationDuration: "5s", ...style }}
      aria-hidden
    >
      <line x1="30" y1="0" x2="30" y2="16" stroke="#4A3F35" strokeWidth="2.5" />
      <rect x="22" y="14" width="16" height="7" rx="2.5" fill="#D2603F" stroke="#4A3F35" strokeWidth="2.2" />
      <ellipse cx="30" cy="44" rx="24" ry="26" fill="#F4C95D" stroke="#4A3F35" strokeWidth="2.8" />
      <ellipse cx="30" cy="44" rx="24" ry="26" fill="#E8845A" opacity="0.25" />
      <path d="M14 32 C22 38 38 38 46 32 M12 44 C22 50 38 50 48 44 M14 56 C22 62 38 62 46 56" fill="none" stroke="#4A3F35" strokeWidth="1.6" opacity="0.5" />
      <ellipse cx="23" cy="36" rx="6" ry="9" fill="#FFF6D8" opacity="0.55" />
      <rect x="23" y="66" width="14" height="6" rx="2.5" fill="#D2603F" stroke="#4A3F35" strokeWidth="2.2" />
      <path d="M30 72 L30 84 M26 84 L34 84 M27 88 L33 88" stroke="#D2603F" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Pricing() {
  const { t } = useT();
  const p = t.pricing;

  return (
    <section id="pricing" className="relative py-20 sm:py-28 bg-gradient-to-b from-paper via-[#FBF0D9] to-paper overflow-hidden">
      {/* 灯笼 */}
      <Lantern className="absolute top-0 left-[7%] w-10 sm:w-14 hidden sm:block" />
      <Lantern className="absolute top-0 right-[9%] w-8 sm:w-12" delay={1.4} />
      <Lantern className="absolute top-0 left-[42%] w-7 hidden lg:block" delay={0.7} />
      <SpritePuff className="anim-floaty absolute bottom-24 left-[3%] w-10 opacity-60 hidden lg:block" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          badge={p.badge}
          title={
            <>
              {p.pre}
              <span className="text-sunset-deep">{p.hi}</span>
              {p.post}
            </>
          }
          subtitle={p.subtitle}
        />

        {/* 免费试用横幅 */}
        <Reveal delay={0.08} className="mt-10">
          <p className="mx-auto w-fit max-w-full text-center px-6 py-3 bg-meadow text-[#FFF9EC] font-display text-base sm:text-lg sketch wobble shadow-paint">
            {p.bannerPre}
            <b className="text-sun">{p.bannerHi}</b>
            {p.bannerPost}
          </p>
        </Reveal>

        <div className="mt-12 grid gap-7 md:grid-cols-3 items-stretch max-w-5xl mx-auto">
          {p.plans.map((plan, i) => {
            const highlight = i === 1;
            return (
              <Reveal key={plan.name} delay={i * 0.1} className="h-full">
                <div
                  className={`relative h-full flex flex-col p-6 sketch transition-all hover:-translate-y-1.5 ${
                    highlight
                      ? "bg-paper-card wobble-2 shadow-paint-lg tape md:-translate-y-3 md:scale-[1.04]"
                      : "bg-paper-card/85 wobble shadow-paint hover:shadow-paint-lg"
                  }`}
                >
                  {highlight && (
                    <span className="absolute -top-4 right-4 inline-flex items-center gap-1 px-3.5 py-1.5 bg-sunset text-[#FFF9EC] font-display text-sm sketch wobble-3 shadow-paint-sm rotate-2">
                      <Sparkles className="w-3.5 h-3.5" /> {p.recommended}
                    </span>
                  )}
                  <p className="font-hand text-xl text-meadow-deep">{plan.cn}</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <h3 className="font-display text-2xl text-ink">{plan.name}</h3>
                  </div>
                  <p className="mt-4 flex items-baseline gap-1">
                    <span className="font-display text-5xl text-ink">{plan.price}</span>
                    <span className="text-ink-faint font-bold text-sm">{p.per}</span>
                  </p>
                  <p className="mt-1.5 text-sm font-bold text-ink-soft">{plan.target}</p>

                  <div className="mt-4 space-y-1.5 text-sm font-bold text-ink">
                    <p className="flex items-center gap-2"><Coins className="w-4 h-4 text-sunset" /> {plan.tasks}</p>
                    <p className="flex items-center gap-2"><Check className="w-4 h-4 text-meadow-deep" strokeWidth={3} /> {plan.accounts}</p>
                  </div>
                  <ul className="mt-4 pt-4 border-t-2 border-dashed border-ink/15 space-y-2 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-ink-soft">
                        <Check className="w-4 h-4 mt-0.5 text-meadow-deep shrink-0" strokeWidth={3} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href="#top"
                    className={`mt-6 inline-flex justify-center items-center px-5 py-3 font-display sketch transition-all hover:-translate-y-0.5 ${
                      highlight ? "bg-sunset text-[#FFF9EC] wobble shadow-paint" : "bg-paper-deep text-ink wobble-2 shadow-paint-sm"
                    }`}
                  >
                    {plan.cta}
                  </a>
                  <p className="mt-2.5 text-center text-xs font-bold text-ink-faint">{p.trialNote}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* 超额与 task 说明 */}
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <Reveal delay={0.1}>
            <div className="h-full bg-paper-card sketch wobble-3 shadow-paint p-6">
              <h4 className="font-display text-lg text-ink">{p.overageTitle}</h4>
              <ul className="mt-3 space-y-2 text-sm text-ink-soft leading-relaxed">
                {p.overage.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="h-full bg-paper-card sketch wobble shadow-paint p-6">
              <h4 className="font-display text-lg text-ink">{p.taskTitle}</h4>
              <ul className="mt-3 space-y-2 text-sm text-ink-soft leading-relaxed">
                {p.taskRules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
