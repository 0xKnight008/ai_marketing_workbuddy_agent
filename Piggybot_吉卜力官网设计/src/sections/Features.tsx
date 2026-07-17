import { Workflow, Sparkles, LayoutTemplate, Inbox, CalendarDays, Gauge } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { SpritePuff } from "../components/ghibli/Piggy";

const FEATURES = [
  {
    icon: Workflow,
    color: "bg-sky-light",
    title: "可视化 Flow Builder",
    desc: "像拼积木一样连接 Trigger、Condition、Action、AI 与审批节点。看到的是业务场景和结果，不是 API endpoint。",
    tag: "No-code 画布",
  },
  {
    icon: Sparkles,
    color: "bg-sun",
    title: "AI Copilot 建造者",
    desc: "说一句人话，精灵为你生成工作流草图，并一步一步解释它打算怎么做。",
    tag: "自然语言建流",
  },
  {
    icon: LayoutTemplate,
    color: "bg-piggy-light",
    title: "模板画廊",
    desc: "内容改写、线索捕获、每周报告、评论自动回复……从模板出发，绝不面对空白画布。",
    tag: "开箱即用",
  },
  {
    icon: Inbox,
    color: "bg-meadow-light",
    title: "统一收件箱",
    desc: "聚合各平台评论与私信，购买意图一出现就触发自动化，商机不再溜走。",
    tag: "评论 / DM 聚合",
  },
  {
    icon: CalendarDays,
    color: "bg-sky-light",
    title: "社交日历",
    desc: "多平台内容排期一眼看全，拖拽调整，精灵按点替你发布。",
    tag: "排期视图",
  },
  {
    icon: Gauge,
    color: "bg-piggy-light",
    title: "用量仪表盘",
    desc: "Task credits、连接账号、运行成功率、错误率——每一分花费都明明白白。",
    tag: "透明计量",
  },
];

export function Features() {
  return (
    <section id="features" className="relative bg-paper paper-grain py-20 sm:py-28 overflow-hidden">
      <SpritePuff className="anim-floaty-slow absolute top-16 left-[3%] w-10 opacity-70 hidden lg:block" />
      <SpritePuff className="anim-floaty absolute bottom-20 right-[4%] w-12 opacity-70 hidden lg:block" style={{ animationDelay: "1s" }} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          badge="精灵的六种超能力"
          title={
            <>
              你负责创意，<span className="text-meadow-deep">杂活交给精灵</span>
            </>
          }
          subtitle="从一条内容到一整个增长闭环，Piggybot 把繁琐的平台对接全部藏在幕后——你看到的只有业务场景和结果。"
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 0.12}>
              <div
                className={`group relative h-full bg-paper-card sketch p-6 sm:p-7 shadow-paint hover:-translate-y-1.5 hover:shadow-paint-lg transition-all duration-300 ${
                  i % 3 === 0 ? "wobble" : i % 3 === 1 ? "wobble-2" : "wobble-3"
                }`}
              >
                <div className={`inline-grid place-items-center w-14 h-14 ${f.color} sketch blob group-hover:scale-110 group-hover:rotate-6 transition-transform`}>
                  <f.icon className="w-7 h-7 text-ink" strokeWidth={2.2} />
                </div>
                <h3 className="mt-4 font-display text-xl text-ink">{f.title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">{f.desc}</p>
                <span className="mt-4 inline-block px-3 py-1 text-xs font-bold text-ink-soft bg-paper-deep sketch-dash wobble-2">
                  {f.tag}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
