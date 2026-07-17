import { motion } from "framer-motion";
import { ArrowDown, Play, Wand2 } from "lucide-react";
import { Piggy, SpritePuff, StarSparkle } from "../components/ghibli/Piggy";
import { Cloud, GrassTuft, Flower, Leaf, Hills } from "../components/ghibli/Scenery";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.14, delayChildren: 0.15 } },
};
const item = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: [0.22, 1, 0.36, 1] as const } },
};

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-gradient-to-b from-[#AEDCF2] via-[#CDEBF5] to-paper">
      {/* 太阳 */}
      <div className="absolute top-20 right-[8%] sm:right-[12%] w-24 sm:w-32 opacity-90" aria-hidden>
        <svg viewBox="0 0 120 120" className="anim-spin-slower w-full h-full">
          <g stroke="#F6B73C" strokeWidth="5" strokeLinecap="round" opacity="0.75">
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i * 30 * Math.PI) / 180;
              return (
                <line
                  key={i}
                  x1={60 + Math.cos(a) * 40}
                  y1={60 + Math.sin(a) * 40}
                  x2={60 + Math.cos(a) * 52}
                  y2={60 + Math.sin(a) * 52}
                />
              );
            })}
          </g>
          <circle cx="60" cy="60" r="30" fill="#F4C95D" stroke="#E8A93C" strokeWidth="4" />
        </svg>
      </div>

      {/* 漂移的云 */}
      <Cloud className="anim-drift absolute top-[12%] w-40 sm:w-56 text-white/95" style={{ animationDuration: "75s", animationDelay: "-18s" }} />
      <Cloud className="anim-drift absolute top-[30%] w-28 sm:w-40 text-white/70" style={{ animationDuration: "95s", animationDelay: "-52s" }} />
      <Cloud className="anim-drift absolute top-[6%] w-24 sm:w-32 text-white/60" style={{ animationDuration: "110s", animationDelay: "-70s" }} />
      <Cloud className="anim-drift absolute top-[44%] w-36 sm:w-52 text-white/50 hidden md:block" style={{ animationDuration: "85s", animationDelay: "-30s" }} />

      {/* 飘落的叶子 */}
      <Leaf className="anim-leaf absolute left-[12%] top-0 w-5 opacity-80" style={{ animationDuration: "16s", animationDelay: "2s" }} />
      <Leaf className="anim-leaf absolute left-[78%] top-0 w-4 opacity-70" style={{ animationDuration: "21s", animationDelay: "7s" }} />
      <Leaf className="anim-leaf absolute left-[55%] top-0 w-4 opacity-60 hidden sm:block" style={{ animationDuration: "18s", animationDelay: "12s" }} />

      {/* 主内容 */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 pt-32 sm:pt-40 pb-10 text-center"
      >
        <motion.div variants={item}>
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-paper-card/90 sketch wobble shadow-paint-sm text-sm font-bold text-ink">
            <SpritePuff className="w-5 h-5" />
            营销运营数字分身 · 会干活的 AI 精灵天团
          </span>
        </motion.div>

        <motion.h1
          variants={item}
          className="mt-7 font-display text-ink text-[2.6rem] leading-[1.15] sm:text-6xl lg:text-[4.6rem]"
        >
          把营销运营
          <br />
          交给<span className="text-sunset-deep brush-underline px-1">会飞的小精灵</span>
        </motion.h1>

        <motion.p variants={item} className="font-hand text-2xl sm:text-3xl text-sky-deep -rotate-2 mt-3">
          your digital twin for marketing ops
        </motion.p>

        <motion.p variants={item} className="mt-5 mx-auto max-w-2xl text-base sm:text-lg text-ink-soft leading-relaxed">
          Piggybot 是你在营销运营领域的数字分身。不用写代码，说一句人话，
          分身们就会把「内容生成 → 审批 → 多平台发布 → 评论私信 → 线索入库 → 复盘报告」
          串成一条自己流动的小河。
        </motion.p>

        <motion.div variants={item} className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#pricing"
            className="inline-flex items-center gap-2 px-7 py-3.5 bg-sunset text-[#FFF9EC] font-display text-lg sketch wobble shadow-paint hover:-translate-y-1 hover:shadow-paint-lg transition-all"
          >
            <Wand2 className="w-5 h-5" />
            免费召唤精灵
          </a>
          <a
            href="#workflows"
            className="inline-flex items-center gap-2 px-7 py-3.5 bg-paper-card text-ink font-display text-lg sketch wobble-2 shadow-paint hover:-translate-y-1 hover:shadow-paint-lg transition-all"
          >
            <Play className="w-5 h-5" />
            看工作流剧场
          </a>
        </motion.div>

        <motion.div variants={item} className="mt-9 flex flex-wrap justify-center gap-2.5 sm:gap-3 text-sm font-bold text-ink">
          {["15+ 社交平台一站连通", "6 大广告平台", "4 大场景模板", "每个动作都可审批"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-paper-card/80 sketch-soft wobble-3">
              <StarSparkle className="w-3.5 h-3.5 text-sun" />
              {t}
            </span>
          ))}
        </motion.div>

        {/* 移动端精灵 */}
        <motion.div variants={item} className="mt-8 md:hidden flex justify-center" aria-hidden>
          <div className="anim-floaty w-40">
            <Piggy className="w-full h-auto drop-shadow-lg" />
            <StarSparkle className="anim-twinkle w-5 h-5 text-sun -mt-6 ml-2" />
          </div>
        </motion.div>
      </motion.div>

      {/* 飞行的 Piggy + 飞行轨迹 */}
      <div className="pointer-events-none absolute inset-0 z-[5]" aria-hidden>
        <svg className="absolute right-[4%] top-[26%] w-[280px] sm:w-[420px] hidden md:block" viewBox="0 0 420 240">
          <path
            d="M20 190 C90 120 180 210 250 130 C300 76 360 110 400 60"
            fill="none"
            stroke="#4A3F35"
            strokeWidth="2.5"
            strokeDasharray="1 12"
            strokeLinecap="round"
            opacity="0.4"
          />
        </svg>
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.7, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="anim-floaty absolute right-[7%] top-[24%] w-36 sm:w-52 lg:w-60 hidden md:block"
        >
          <Piggy className="w-full h-auto drop-shadow-lg" />
          <StarSparkle className="anim-twinkle absolute -left-6 top-6 w-6 h-6 text-sun" />
          <StarSparkle className="anim-twinkle absolute -right-2 bottom-8 w-4 h-4 text-sun" style={{ animationDelay: "1.2s" }} />
        </motion.div>

        {/* 小煤球精灵 */}
        <SpritePuff className="anim-floaty-slow absolute left-[6%] top-[52%] w-10 sm:w-14 hidden sm:block" />
        <SpritePuff className="anim-floaty absolute left-[16%] top-[64%] w-7 hidden lg:block" style={{ animationDelay: "1.5s" }} />
        <SpritePuff className="anim-floaty-slow absolute right-[26%] top-[62%] w-9 hidden lg:block" style={{ animationDelay: "0.8s" }} />
      </div>

      {/* 滚动提示 */}
      <div className="relative z-10 flex justify-center pb-3">
        <a href="#features" className="flex flex-col items-center gap-1 text-ink-soft hover:text-ink transition-colors">
          <span className="font-hand text-xl">向下滚动，进入精灵村</span>
          <ArrowDown className="w-5 h-5 animate-bounce" />
        </a>
      </div>

      {/* 山丘 + 花草 */}
      <div className="relative z-[4] -mb-1">
        <div className="absolute bottom-0 inset-x-0 flex justify-between px-[4%] pb-2 pointer-events-none z-10" aria-hidden>
          <div className="flex items-end gap-4">
            <GrassTuft className="w-10 text-meadow-dark" />
            <Flower className="w-6 mb-1" color="#FFFDF6" />
            <GrassTuft className="w-8 text-meadow-deep hidden sm:block" delay={0.7} />
          </div>
          <div className="flex items-end gap-4">
            <Flower className="w-5 mb-1 hidden sm:block" color="#F6AEBB" />
            <GrassTuft className="w-10 text-meadow-dark" delay={1.3} />
            <GrassTuft className="w-7 text-meadow-deep" delay={0.4} />
          </div>
        </div>
        <Hills className="w-full h-36 sm:h-48" />
      </div>
    </section>
  );
}
