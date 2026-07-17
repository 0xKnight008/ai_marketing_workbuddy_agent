import { PenLine, MessagesSquare, FileBarChart2, ShieldCheck, MoveRight, Coins } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { GrassTuft } from "../components/ghibli/Scenery";

const WORKFLOWS = [
  {
    icon: PenLine,
    color: "bg-piggy-light",
    scene: "第一幕",
    title: "内容一变多排期",
    persona: "创作者",
    quote: "“粘一个想法，变出全平台的版本。”",
    steps: ["手动触发", "AI 识别主题", "AI 生成 4 平台版本", "人工审批", "多平台排期发布", "飞书通知"],
    cost: "1 AI + 4 发布 ≈ 5 task / 次",
  },
  {
    icon: MessagesSquare,
    color: "bg-sky-light",
    scene: "第二幕",
    title: "评论变线索",
    persona: "增长营销",
    quote: "“购买意图一出现，线索自动入库。”",
    steps: ["新评论触发", "AI 识别意图", "条件：购买 / 询价", "模板回复", "写入 HubSpot", "销售群提醒"],
    cost: "分类按批计费，回复 1 task / 条",
  },
  {
    icon: FileBarChart2,
    color: "bg-sun",
    scene: "第三幕",
    title: "每周增长报告",
    persona: "代理商经理",
    quote: "“每个客户，周一早上都收到自动周报。”",
    steps: ["周一 9:00 触发", "拉取多账号数据", "AI 总结得失", "写入 Docs / Notion", "发送客户", "审计留档"],
    cost: "整份报告 ≈ 3 task",
  },
  {
    icon: ShieldCheck,
    color: "bg-meadow-light",
    scene: "第四幕",
    title: "广告守护助手",
    persona: "预算负责人",
    quote: "“超支之前，精灵先问你一声。”",
    steps: ["每日巡检", "拉取 Campaigns", "CPL 超阈值？", "AI 解释原因", "审批：暂停 / 降预算", "执行变更"],
    cost: "巡检 0 task，执行才算",
  },
];

export function Workflows() {
  return (
    <section id="workflows" className="relative py-20 sm:py-28 bg-gradient-to-b from-paper via-meadow-light/35 to-paper overflow-hidden">
      <GrassTuft className="absolute bottom-6 left-[5%] w-10 text-meadow/60 hidden lg:block" />
      <GrassTuft className="absolute bottom-6 right-[6%] w-8 text-meadow/60 hidden lg:block" delay={0.9} />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          badge="工作流剧场"
          title={
            <>
              四出拿手好戏，<span className="text-meadow-deep">每天都在上演</span>
            </>
          }
          subtitle="每一幕都来自真实的营销日常。从模板一键开演，也可以让 Copilot 按你的剧本改。"
        />

        <div className="mt-14 grid gap-7 lg:grid-cols-2">
          {WORKFLOWS.map((w, i) => (
            <Reveal key={w.title} delay={(i % 2) * 0.12}>
              <article
                className={`relative h-full bg-paper-card sketch p-6 sm:p-8 shadow-paint hover:shadow-paint-lg hover:-translate-y-1 transition-all ${
                  i % 2 === 0 ? "wobble" : "wobble-2"
                } ${i === 1 ? "tape" : ""}`}
              >
                <div className="flex items-start gap-4">
                  <span className={`grid place-items-center w-14 h-14 ${w.color} sketch blob shrink-0`}>
                    <w.icon className="w-7 h-7 text-ink" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-hand text-xl text-sunset-deep leading-none">{w.scene}</p>
                    <h3 className="mt-1 font-display text-2xl text-ink">{w.title}</h3>
                  </div>
                  <span className="ml-auto shrink-0 px-3 py-1 text-xs font-bold bg-paper-deep sketch-dash wobble-3 text-ink-soft">
                    {w.persona}
                  </span>
                </div>

                <p className="mt-4 font-hand text-2xl text-ink-soft">{w.quote}</p>

                {/* 步骤管线 */}
                <div className="mt-5 flex flex-wrap items-center gap-y-2.5">
                  {w.steps.map((s, j) => (
                    <span key={j} className="flex items-center">
                      <span
                        className={`px-3 py-1.5 text-[13px] font-bold sketch-soft whitespace-nowrap ${
                          s.includes("AI")
                            ? "bg-sun/70 text-ink"
                            : s.includes("审批") || s.includes("条件")
                            ? "bg-piggy-light text-ink"
                            : "bg-paper text-ink"
                        } ${j % 2 === 0 ? "wobble-3" : "wobble-2"}`}
                      >
                        {s}
                      </span>
                      {j < w.steps.length - 1 && <MoveRight className="w-4 h-4 mx-1 text-ink-faint shrink-0" />}
                    </span>
                  ))}
                </div>

                <div className="mt-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ink text-sun font-bold text-[13px] wobble-2">
                  <Coins className="w-4 h-4" />
                  {w.cost}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
