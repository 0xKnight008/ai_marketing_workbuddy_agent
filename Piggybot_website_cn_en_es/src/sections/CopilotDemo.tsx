import { motion } from "framer-motion";
import { Clock, BarChart3, Sparkles, FileText, Send, Check, FlaskConical, MessageCircle, ShieldCheck, Wand2 } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { Piggy } from "../components/ghibli/Piggy";
import { Cloud } from "../components/ghibli/Scenery";
import { useT } from "../i18n/LangContext";

const STEP_ICONS = [Clock, BarChart3, Sparkles, FileText, Send];
const STEP_COLORS = ["bg-sky-light", "bg-meadow-light", "bg-sun", "bg-piggy-light", "bg-sky-light"];
const BULLET_ICONS = [Wand2, MessageCircle, FlaskConical, ShieldCheck];

export function CopilotDemo() {
  const { t } = useT();
  const c = t.copilot;

  return (
    <section id="copilot" className="relative py-20 sm:py-28 overflow-hidden bg-gradient-to-b from-sky-light/60 via-[#DFF1F8] to-paper">
      <Cloud className="absolute top-10 left-[6%] w-36 text-white/80" />
      <Cloud className="absolute top-24 right-[8%] w-28 text-white/60 hidden md:block" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* 左侧文案 */}
        <div>
          <SectionTitle
            align="left"
            badge={c.badge}
            title={
              <>
                {c.l1}
                <br />
                {c.l2pre}
                <span className="text-sunset-deep">{c.l2hi}</span>
              </>
            }
            subtitle={c.subtitle}
          />
          <Reveal delay={0.15} className="mt-8 space-y-3.5">
            {c.bullets.map((text, i) => {
              const Icon = BULLET_ICONS[i];
              return (
                <div key={text} className="flex items-center gap-3 text-ink">
                  <span className="grid place-items-center w-9 h-9 bg-paper-card sketch blob shrink-0">
                    <Icon className="w-[18px] h-[18px] text-meadow-deep" />
                  </span>
                  <span className="font-bold text-[15px]">{text}</span>
                </div>
              );
            })}
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
                  <p className="font-display text-ink leading-tight">{c.windowTitle}</p>
                  <p className="text-xs text-ink-faint">{c.windowStatus}</p>
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
                  {c.userMsg}
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
                    {c.botMsg}
                  </div>

                  {/* 工作流草稿卡 */}
                  <div className="mt-3 bg-paper sketch wobble p-4 shadow-paint-sm">
                    <p className="font-display text-sm text-ink-soft">{c.draftTitle}</p>
                    <div className="mt-3 space-y-0">
                      {c.steps.map((s, i) => {
                        const Icon = STEP_ICONS[i];
                        return (
                          <motion.div
                            key={s.label}
                            initial={{ opacity: 0, x: -18 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.9 + i * 0.22, duration: 0.45 }}
                            className="relative flex items-center gap-3 pb-3 last:pb-0"
                          >
                            {i < c.steps.length - 1 && (
                              <span className="absolute left-[19px] top-9 bottom-0 w-0 border-l-2 border-dashed border-ink/25" />
                            )}
                            <span className={`relative z-10 grid place-items-center w-10 h-10 ${STEP_COLORS[i]} sketch blob shrink-0`}>
                              <Icon className="w-5 h-5 text-ink" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-bold text-ink text-[15px] leading-tight">{s.label}</p>
                              <p className="text-xs text-ink-soft">{s.detail}</p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>

                    <motion.div
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 2.1, duration: 0.5 }}
                      className="mt-4 flex flex-wrap items-center gap-2.5"
                    >
                      <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-meadow text-[#FFF9EC] font-display text-sm sketch wobble shadow-paint-sm hover:-translate-y-0.5 transition-transform">
                        <Check className="w-4 h-4" /> {c.accept}
                      </button>
                      <button className="inline-flex items-center gap-1.5 px-4 py-2 bg-paper-card text-ink font-display text-sm sketch wobble-2 shadow-paint-sm hover:-translate-y-0.5 transition-transform">
                        <FlaskConical className="w-4 h-4" /> {c.dryrun}
                      </button>
                      <span className="ml-auto text-xs font-bold text-ink-faint">{c.costNote}</span>
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
