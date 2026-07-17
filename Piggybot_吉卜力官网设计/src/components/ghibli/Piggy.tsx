import React from "react";
import piggyHead from "../../assets/piggy-head.webp";

/**
 * Piggy —— Piggybot 的精灵吉祥物：水彩风小猪机器人精灵。
 */
export function Piggy({
  className = "",
  style,
  flying = true,
}: {
  className?: string;
  style?: React.CSSProperties;
  flying?: boolean;
}) {
  void flying; // 图片版吉祥物无翅膀动画，保留 prop 兼容
  return (
    <img
      src={piggyHead}
      alt="Piggy 精灵"
      draggable={false}
      className={`select-none object-contain ${className}`}
      style={style}
    />
  );
}


/**
 * SpritePuff —— 灰尘精灵一样的“任务小煤球”，每个成功执行的 task 都是一只。
 */
export function SpritePuff({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 100 100" className={className} style={style} aria-label="任务小精灵">
      <path
        d="M50 6 Q56 20 64 11 Q66 27 79 20 Q76 35 90 33 Q83 45 94 50 Q83 55 90 67 Q76 65 79 80 Q66 73 64 89 Q56 80 50 94 Q44 80 36 89 Q34 73 21 80 Q24 65 10 67 Q17 55 6 50 Q17 45 10 33 Q24 35 21 20 Q34 27 36 11 Q44 20 50 6 Z"
        fill="#3A3348"
        stroke="#4A3F35"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <ellipse cx="38" cy="48" rx="9" ry="11" fill="#FFFDF6" />
      <ellipse cx="62" cy="48" rx="9" ry="11" fill="#FFFDF6" />
      <circle cx="40" cy="51" r="3.5" fill="#3A3348" />
      <circle cx="60" cy="51" r="3.5" fill="#3A3348" />
    </svg>
  );
}

/** 四角星星闪光 */
export function StarSparkle({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden>
      <path
        d="M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z"
        fill="currentColor"
        stroke="#4A3F35"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
