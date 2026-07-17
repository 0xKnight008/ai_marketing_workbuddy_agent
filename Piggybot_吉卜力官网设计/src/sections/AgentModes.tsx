import { Lightbulb, HandHeart, Rocket, Check } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { StarSparkle } from "../components/ghibli/Piggy";

const MODES = [
  {
    icon: Lightbulb,
    color: "bg-sky-light",
    level: "修行 · 壹",
    name: "Copilot 建议模式",
    slogan: "只出主意，不动手",
    desc: "精灵给建议、画草稿，所有执行都由你亲手点下确认键。",
    fit: "适合：刚搬进精灵村的新手",
    points: ["生成建议与草稿", "解释每一步逻辑", "手动确认后执行"],
    highlight: false,
  },
  {
    icon: HandHeart,
    color: "bg-sun",
    level: "修行 · 贰",
    name: "Assisted 协助模式",
    slogan: "低风险自动做，高风险先敲门",
    desc: "日常杂务自动完成；公开发布、回复客户、调整广告预算前，一定先请你批准。",
    fit: "适合：大多数团队（默认推荐）",
    points: ["低风险动作自动执行", "敏感动作默认送审批", "审批后才会计费执行"],
    highlight: true,
  },
  {
    icon: Rocket,
    color: "bg-piggy-light",
    level: "修行 · 叁",
    name: "Autopilot 自动模式",
    slogan: "结界之内，自由飞行",
    desc: "在你画好的 policy sandbox 里全自主执行，全程留痕，随时可回滚。",
    fit: "适合：流程成熟的增长团队",
    points: ["策略沙盒内自主执行", "每次决策全程留痕", "一键回滚任意动作"],
    highlight: false,
  },
];

export function AgentModes() {
  return (
    <section id="modes" className="relative py-20 sm:py-28 bg-paper paper-grain overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          badge="精灵的三种修行模式"
          title={
            <>
              自主权由你授予，<span className="text-sunset-deep">一步一步来</span>
            </>
          }
          subtitle="不是传统的 if-this-then-that，而是 AI Agent 在边界内规划、调用工具、总结、请求审批。信任是慢慢建立的，精灵懂这个道理。"
        />

        <div className="mt-14 grid gap-7 md:grid-cols-3 items-stretch">
          {MODES.map((m, i) => (
            <Reveal key={m.name} delay={i * 0.13} className="h-full">
              <div
                className={`relative h-full flex flex-col p-7 sketch shadow-paint transition-all hover:-translate-y-1.5 hover:shadow-paint-lg ${
                  m.highlight ? "bg-paper-card wobble-2 md:-translate-y-3 md:scale-[1.03] shadow-paint-lg" : "bg-paper-card/80 wobble"
                }`}
              >
                {m.highlight && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-4 py-1.5 bg-sunset text-[#FFF9EC] font-display text-sm sketch wobble-3 shadow-paint-sm whitespace-nowrap">
                    <StarSparkle className="w-3.5 h-3.5 text-sun" /> 村民最爱
                  </span>
                )}
                <p className="font-hand text-xl text-meadow-deep">{m.level}</p>
                <span className={`mt-3 grid place-items-center w-14 h-14 ${m.color} sketch blob`}>
                  <m.icon className="w-7 h-7 text-ink" strokeWidth={2.2} />
                </span>
                <h3 className="mt-4 font-display text-2xl text-ink">{m.name}</h3>
                <p className="mt-1 font-display text-sunset-deep">{m.slogan}</p>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft flex-1">{m.desc}</p>
                <ul className="mt-4 space-y-2">
                  {m.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-sm font-bold text-ink">
                      <Check className="w-4 h-4 text-meadow-deep shrink-0" strokeWidth={3} />
                      {p}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 pt-4 border-t-2 border-dashed border-ink/15 text-[13px] font-bold text-ink-faint">{m.fit}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.2} className="mt-10 text-center">
          <p className="inline-block px-6 py-3 bg-paper-deep sketch-dash wobble-3 text-ink-soft font-bold text-sm">
            三种模式共享同一套审批与审计结界，随时切换，随时收回授权
          </p>
        </Reveal>
      </div>
    </section>
  );
}
