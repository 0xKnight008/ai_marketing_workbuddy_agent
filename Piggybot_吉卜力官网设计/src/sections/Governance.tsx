import { Stamp, Users, ScrollText, KeyRound } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { Piggy, StarSparkle } from "../components/ghibli/Piggy";
import { TwinkleStar } from "../components/ghibli/Scenery";

const ITEMS = [
  {
    icon: Stamp,
    title: "审批策略",
    desc: "按动作、金额、平台、品牌、角色灵活触发审批。公开发布、回复客户、改动预算——都得先敲你的门。",
  },
  {
    icon: Users,
    title: "RBAC + 托管连接",
    desc: "凭据归团队所有，成员不直接接触 token。人走了，自动化还在稳稳运行。",
  },
  {
    icon: ScrollText,
    title: "不可篡改审计日志",
    desc: "每次 AI 决策、工具调用、输入输出与 task 费用全部留痕。老板问起来，一分钟拿出全账。",
  },
  {
    icon: KeyRound,
    title: "密钥保险库",
    desc: "OAuth token 与 API key 加密保存，最小权限授权，数据保留周期按工作区可配。",
  },
];

export function Governance() {
  return (
    <section id="governance" className="relative py-20 sm:py-28 overflow-hidden bg-gradient-to-b from-[#3D5A80] via-[#2C3E67] to-night">
      {/* 星星 */}
      <TwinkleStar style={{ left: "8%", top: "14%" }} />
      <TwinkleStar style={{ left: "22%", top: "8%", animationDelay: "0.8s" }} />
      <TwinkleStar style={{ left: "45%", top: "18%", animationDelay: "1.6s" }} />
      <TwinkleStar style={{ left: "66%", top: "10%", animationDelay: "0.4s" }} />
      <TwinkleStar style={{ left: "85%", top: "20%", animationDelay: "2.1s" }} />
      <TwinkleStar style={{ left: "93%", top: "8%", animationDelay: "1.1s" }} />
      <TwinkleStar style={{ left: "35%", top: "6%", animationDelay: "2.6s" }} />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          dark
          badge="安心结界 · Governance"
          title={
            <>
              精灵再能干，<span className="text-sun">也飞不出你的结界</span>
            </>
          }
          subtitle="治理不是企业版加购项，而是 AI 自动化信任的地基。每一次动作可审批、可追踪、可回滚、可计费。"
        />

        <div className="mt-14 grid lg:grid-cols-[1fr_1.2fr] gap-12 items-center">
          {/* 结界气泡 */}
          <Reveal className="relative mx-auto w-64 sm:w-80">
            <div className="relative">
              {/* 光环 */}
              <div className="absolute inset-0 rounded-full bg-sun/15 blur-2xl scale-110" aria-hidden />
              <div className="anim-pulse-soft absolute inset-0 rounded-full border-4 border-dashed border-sun/50" aria-hidden />
              <div className="relative rounded-full bg-gradient-to-b from-[#5FA8D3]/25 to-[#F4C95D]/10 backdrop-blur-[2px] border-[3px] border-[#F6E7C1]/60 p-8 sm:p-10">
                <Piggy className="w-full h-auto anim-floaty" />
              </div>
              {/* 环绕的小星星 */}
              <StarSparkle className="anim-twinkle absolute -top-2 right-6 w-6 h-6 text-sun" />
              <StarSparkle className="anim-twinkle absolute bottom-4 -left-3 w-5 h-5 text-sun" style={{ animationDelay: "1s" }} />
              <StarSparkle className="anim-twinkle absolute top-1/2 -right-4 w-4 h-4 text-sun" style={{ animationDelay: "1.8s" }} />
              <p className="mt-6 text-center font-hand text-2xl text-[#F6E7C1] -rotate-2">
                “在结界里，安心飞。”
              </p>
            </div>
          </Reveal>

          {/* 治理卡片 */}
          <div className="grid sm:grid-cols-2 gap-5">
            {ITEMS.map((it, i) => (
              <Reveal key={it.title} delay={i * 0.1}>
                <div className={`h-full bg-[#FDF6E4]/95 sketch p-5 sm:p-6 shadow-paint hover:-translate-y-1 hover:shadow-paint-lg transition-all ${i % 2 === 0 ? "wobble" : "wobble-2"}`}>
                  <span className="grid place-items-center w-12 h-12 bg-sun sketch blob">
                    <it.icon className="w-6 h-6 text-ink" strokeWidth={2.2} />
                  </span>
                  <h3 className="mt-3 font-display text-xl text-ink">{it.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{it.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
