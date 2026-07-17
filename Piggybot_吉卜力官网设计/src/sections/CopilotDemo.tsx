import { motion } from "framer-motion";
import { Clock, BarChart3, Sparkles, FileText, Send, Check, FlaskConical, MessageCircle, ShieldCheck, Wand2 } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { Piggy } from "../components/ghibli/Piggy";
import { Cloud } from "../components/ghibli/Scenery";

const STEPS = [
  { icon: Clock, label: "定时触发", detail: "每周五 17:00 自动启动", color: "bg-sky-light" },
  { icon: BarChart3, label: "自动拉取数据", detail: "汇总各平台本周表现", color: "bg-meadow-light" },
  { icon: Sparkles, label: "AI · 生成总结", detail: "亮点、踩坑与下周选题建议", color: "bg-sun" },
  { icon: FileText, label: "写入 Notion", detail: "归档成团队知识库", color: "bg-piggy-light" },
  { icon: Send, label: "发送到飞书群", detail: "@相关同事查收", color: "bg-sky-light" },
];

export function CopilotDemo() {
  return (
    <section id="copilot" className="relative py-20 sm:py-28 overflow-hidden bg-gradient-to-b from-sky-light/60 via-[#DFF1F8] to-paper">
      <Cloud className="absolute top-10 left-[6%] w-36 text-white/80" />
      <Cloud className="absolute top-24 right-[8%] w-28 text-white/60 hidden md:block" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* 左侧文案 */}
        <div>
          <SectionTitle
            align="left"
            badge="咒语演示 · AI Copilot Builder"
            title={
              <>
                说一句人话，
                <br />
                精灵<span className="text-sunset-deep">画好整张地图</span>
              </>
            }
            subtitle="不需要懂 API，也不需要从空白画布开始。描述你想要的结果，Copilot 会生成工作流草稿、解释每一步，并先试运行给你看。"
          />
          <Reveal delay={0.15} className="mt-8 space-y-3.5">
            {[
              { icon: Wand2, text: "自然语言生成 workflow draft，随改随用" },
              { icon: MessageCircle, text: "每一步都有解释——精灵从不说黑话" },
              { icon: FlaskConical, text: "Dry-run 试运行：先彩排，再正式上岗" },
              { icon: ShieldCheck, text: "敏感动作默认请求审批，绝不擅自行动" },
            ].map((b) => (
              <div key={b.text} className="flex items-center gap-3 text-ink">
                <span className="grid place-items-center w-9 h-9 bg-paper-card sketch blob shrink-0">
                  <b.icon className="w-4.5 h-4.5 w-[18px] h-[18px] text-meadow-deep" />
                </span>
                <span className="font-bold text-[15px]">{b.text}</span>
              </div>
            ))}
          </Reveal>
        </div>

        {/* 右侧聊天窗 */}
        <Reveal delay={0.1}>
          <div className="relative">
            <div className="absolute -top-10 -left-6 w-20 anim-floaty hidden sm:block" aria-hidden>
              <Piggy className="w-full h-auto" />
            </div>
            <div className="bg-paper-card sketch wobble shadow-paint-lg p-5 sm:p-7 tape">
              {/* 窗口头 */}
              <div className="flex items-center gap-2.5 pb-4 border-b-2 border-dashed border-ink/20">
                <span className="w-8 h-8"><Piggy className="w-full h-full" flying={false} /></span>
                <div>
                  <p className="font-display text-ink leading-tight">Piggybot Copilot</p>
                  <p className="text-xs text-ink-faint">在线 · 随时待命</p>
                </div>
                <span className="ml-auto flex gap-1.5">
                  <i className="w-3 h-3 rounded-full bg-piggy sketch-soft" />
                  <i className="w-3 h-3 rounded-full bg-sun sketch-soft" />
                  <i className="w-3 h-3 rounded-full bg-meadow-light sketch-soft" />
                </span>
              </div>

              {/* 用户消息 */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.25, duration: 0.5 }}
                className="mt-5 flex justify-end"
              >
                <div className="max-w-[85%] bg-sky-light sketch wobble-2 px-4 py-3 text-[15px] font-bold text-ink shadow-paint-sm">
                  每周五把本周表现最好的帖子总结成报告，发给团队。🙏
                </div>
              </motion.div>

              {/* 精灵回复 */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.6, duration: 0.5 }}
                className="mt-4 flex gap-2.5"
              >
                <span className="w-7 h-7 shrink-0 mt-1"><Piggy className="w-full h-full" flying={false} /></span>
                <div className="max-w-[88%]">
                  <div className="bg-paper-deep sketch-soft wobble-3 px-4 py-2.5 text-[15px] font-bold text-ink">
                    好嘞！草图画好了，你看看这条路顺不顺：
                  </div>

                  {/* 工作流草稿卡 */}
                  <div className="mt-3 bg-paper sketch wobble p-4 shadow-paint-sm">
                    <p className="font-display text-sm text-ink-soft">📋 工作流草稿 · 每周增长报告</p>
                    <div className="mt-3 space-y-0">
                      {STEPS.map((s, i) => (
                        <motion.div
                          key={s.label}
                          initial={{ opacity: 0, x: -18 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.9 + i * 0.22, duration: 0.45 }}
                          className="relative flex items-center gap-3 pb-3 last:pb-0"
                        >
                          {i < STEPS.length - 1 && (
                            <span className="absolute left-[19px] top-9 bottom-0 w-0 border-l-2 border-dashed border-ink/25" />
                          )}
                          <span className={`relative z-10 grid place-items-center w-10 h-10 ${s.color} sketch blob shrink-0`}>
                            <s.icon className="w-5 h-5 text-ink" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-bold text-ink text-[15px] leading-tight">{s.label}</p>
                            <p className="text-xs text-ink-soft">{s.detail}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    <motion.div
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 2.1, duration: 0.5 }}
                      className="mt-4 flex flex-wrap items-center gap-2.5"
                    >
                      <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-meadow text-[#FFF9EC] font-display text-sm sketch wobble shadow-paint-sm hover:-translate-y-0.5 transition-transform">
                        <Check className="w-4 h-4" /> 接受草稿
                      </button>
                      <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-paper-card text-ink font-display text-sm sketch wobble-2 shadow-paint-sm hover:-translate-y-0.5 transition-transform">
                        <FlaskConical className="w-4 h-4" /> 先试运行
                      </button>
                      <span className="ml-auto text-xs font-bold text-ink-faint">预计每次运行 ≈ 3 task</span>
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
