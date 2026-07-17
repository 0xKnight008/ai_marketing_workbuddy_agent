import { StarSparkle } from "../components/ghibli/Piggy";

const ITEMS = [
  "内容一变多",
  "评论变线索",
  "每周增长报告",
  "广告守护",
  "统一收件箱",
  "社交日历",
  "自然语言建流",
  "审批与回滚",
  "任务精灵计费",
  "品牌声音记忆",
];

/** 手绘横幅跑马灯 */
export function Marquee() {
  const doubled = [...ITEMS, ...ITEMS];
  return (
    <div className="relative bg-paper py-6 overflow-hidden" aria-hidden>
      <div className="-rotate-1 bg-meadow-deep border-y-[3px] border-ink py-3.5 shadow-paint-sm">
        <div className="anim-marquee flex w-max items-center gap-8 whitespace-nowrap">
          {doubled.map((t, i) => (
            <span key={i} className="inline-flex items-center gap-8 text-paper-card font-display text-lg">
              {t}
              <StarSparkle className="w-4 h-4 text-sun" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
