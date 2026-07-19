import { StarSparkle } from "../components/ghibli/Piggy";
import { useT } from "../i18n/LangContext";

/** 手绘横幅跑马灯 */
export function Marquee() {
  const { t } = useT();
  const doubled = [...t.marquee, ...t.marquee];
  return (
    <div className="relative bg-paper py-6 overflow-hidden" aria-hidden>
      <div className="-rotate-1 bg-meadow-deep border-y-[3px] border-ink py-3.5 shadow-paint-sm">
        <div className="anim-marquee flex w-max items-center gap-8 whitespace-nowrap">
          {doubled.map((txt, i) => (
            <span key={i} className="inline-flex items-center gap-8 text-paper-card font-display text-lg">
              {txt}
              <StarSparkle className="w-4 h-4 text-sun" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
