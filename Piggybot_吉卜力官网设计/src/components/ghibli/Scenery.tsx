import React from "react";

/** 软绵绵的手绘云 */
export function Cloud({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 140 90" className={className} style={style} aria-hidden>
      <path
        d="M46.7 74 C29.5 74 20 63 20 51.5 C20 42 27.5 34.5 37 32.5 C39 21 49.5 12 61.5 12 C73.5 12 84 20.5 86.5 32 C98.5 32.5 108 41.5 108 52.5 C108 64.5 98 74 84.5 74 Z"
        fill="currentColor"
      />
      <ellipse cx="52" cy="66" rx="16" ry="6" fill="#BEE3F0" opacity="0.5" />
    </svg>
  );
}

/** 摇曳的草丛 */
export function GrassTuft({
  className = "",
  style,
  delay = 0,
}: {
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
}) {
  return (
    <svg
      viewBox="0 0 60 44"
      className={`anim-sway ${className}`}
      style={{ animationDelay: `${delay}s`, ...style }}
      aria-hidden
    >
      <path d="M8 42 C10 28 6 18 2 10" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M20 42 C20 24 16 12 12 4" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M30 42 C30 26 32 14 34 6" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M42 42 C42 30 46 20 52 12" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M52 42 C52 34 56 28 58 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

/** 小野花 */
export function Flower({
  className = "",
  style,
  color = "#FFFDF6",
}: {
  className?: string;
  style?: React.CSSProperties;
  color?: string;
}) {
  return (
    <svg viewBox="0 0 40 56" className={className} style={style} aria-hidden>
      <path d="M20 54 C20 42 20 34 20 26" fill="none" stroke="#5C8A4D" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 40 C14 38 10 34 9 30" fill="none" stroke="#5C8A4D" strokeWidth="2.5" strokeLinecap="round" />
      <g className="anim-pulse-soft" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        {[0, 72, 144, 216, 288].map((deg) => (
          <ellipse key={deg} cx="20" cy="14" rx="5" ry="8" fill={color} stroke="#4A3F35" strokeWidth="1.6" transform={`rotate(${deg} 20 20)`} />
        ))}
        <circle cx="20" cy="20" r="5" fill="#F4C95D" stroke="#4A3F35" strokeWidth="1.6" />
      </g>
    </svg>
  );
}

/** 飘落的叶子 */
export function Leaf({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 30 30" className={className} style={style} aria-hidden>
      <path
        d="M15 3 C24 8 26 18 15 27 C4 18 6 8 15 3 Z"
        fill="#A8C686"
        stroke="#5C8A4D"
        strokeWidth="1.8"
      />
      <path d="M15 6 C15 12 15 18 15 24" fill="none" stroke="#5C8A4D" strokeWidth="1.5" />
    </svg>
  );
}

/** 手绘波浪分隔带 */
export function WavyDivider({
  className = "",
  fill = "#FDF6E4",
  flip = false,
  style,
}: {
  className?: string;
  fill?: string;
  flip?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 1440 90"
      preserveAspectRatio="none"
      className={className}
      style={{ display: "block", transform: flip ? "scaleY(-1)" : undefined, ...style }}
      aria-hidden
    >
      <path
        d="M0 56 C70 30 130 74 210 52 C290 30 350 76 430 54 C510 32 570 74 650 52 C730 30 790 76 870 54 C950 32 1010 74 1090 52 C1170 30 1230 76 1310 54 C1370 38 1420 58 1440 50 L1440 92 L0 92 Z"
        fill={fill}
      />
    </svg>
  );
}

/** 山丘（英雄区底部） */
export function Hills({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 300"
      preserveAspectRatio="none"
      className={className}
      style={{ display: "block" }}
      aria-hidden
    >
      {/* 远山 */}
      <path
        d="M0 190 C180 120 380 105 600 160 C820 215 1040 105 1240 140 C1330 156 1400 150 1440 138 L1440 300 L0 300 Z"
        fill="#C9DCA7"
      />
      {/* 远山上的小树 */}
      <g fill="#7FB069">
        <circle cx="300" cy="140" r="10" />
        <circle cx="312" cy="146" r="7" />
        <circle cx="1060" cy="132" r="11" />
        <circle cx="1073" cy="139" r="7" />
      </g>
      {/* 近丘 */}
      <path
        d="M0 250 C200 185 430 195 660 235 C890 275 1130 185 1440 225 L1440 300 L0 300 Z"
        fill="#7FB069"
      />
      {/* 蜿蜒小路 */}
      <path
        d="M620 300 C660 268 700 258 760 250 C830 240 880 238 940 226"
        fill="none"
        stroke="#F5EBD3"
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray="2 22"
        opacity="0.9"
      />
    </svg>
  );
}

/** 月亮（页脚夜景） */
export function Moon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <circle cx="50" cy="50" r="38" fill="#F6E7C1" stroke="#E8D5A8" strokeWidth="3" />
      <circle cx="38" cy="40" r="7" fill="#E8D5A8" opacity="0.7" />
      <circle cx="60" cy="58" r="9" fill="#E8D5A8" opacity="0.6" />
      <circle cx="58" cy="34" r="4.5" fill="#E8D5A8" opacity="0.6" />
    </svg>
  );
}

/** 夜晚山丘剪影 */
export function NightHills({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 220"
      preserveAspectRatio="none"
      className={className}
      style={{ display: "block" }}
      aria-hidden
    >
      <path
        d="M0 130 C200 70 420 60 640 105 C860 150 1080 55 1440 95 L1440 220 L0 220 Z"
        fill="#1A2440"
      />
      <path
        d="M0 175 C220 120 460 130 700 160 C940 190 1180 120 1440 150 L1440 220 L0 220 Z"
        fill="#10182E"
      />
      {/* 小房子剪影（精灵村） */}
      <g fill="#0B1226" stroke="#2C3E67" strokeWidth="2">
        <path d="M180 168 L212 168 L212 142 L196 130 L180 142 Z" />
        <rect x="192" y="152" width="8" height="11" rx="2" fill="#F4C95D" stroke="none" opacity="0.9" />
        <path d="M520 148 L556 148 L556 120 L538 106 L520 120 Z" />
        <rect x="532" y="132" width="9" height="12" rx="2" fill="#F4C95D" stroke="none" opacity="0.9" />
        <path d="M586 152 L616 152 L616 128 L601 116 L586 128 Z" />
        <rect x="597" y="138" width="8" height="10" rx="2" fill="#F4C95D" stroke="none" opacity="0.85" />
        <path d="M900 138 L940 138 L940 108 L920 92 L900 108 Z" />
        <rect x="914" y="120" width="10" height="13" rx="2" fill="#F4C95D" stroke="none" opacity="0.9" />
        <path d="M1210 160 L1244 160 L1244 134 L1227 120 L1210 134 Z" />
        <rect x="1222" y="144" width="9" height="11" rx="2" fill="#F4C95D" stroke="none" opacity="0.9" />
      </g>
    </svg>
  );
}

/** 萤火虫群 */
export function Fireflies({ count = 12 }: { count?: number }) {
  const flies = React.useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 83) % 100}%`,
        top: `${18 + ((i * 37) % 60)}%`,
        delay: `${(i * 0.9) % 7}s`,
        duration: `${5 + ((i * 1.3) % 5)}s`,
        size: 4 + ((i * 3) % 5),
      })),
    [count]
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {flies.map((f, i) => (
        <span
          key={i}
          className="anim-firefly absolute rounded-full"
          style={{
            left: f.left,
            top: f.top,
            width: f.size,
            height: f.size,
            background: "#F4C95D",
            boxShadow: "0 0 10px 3px rgba(244,201,93,0.55)",
            animationDelay: f.delay,
            animationDuration: f.duration,
          }}
        />
      ))}
    </div>
  );
}

/** 星点（闪烁） */
export function TwinkleStar({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`anim-twinkle absolute rounded-full bg-[#FFF6D8] ${className}`}
      style={{ width: 4, height: 4, boxShadow: "0 0 8px 2px rgba(255,246,216,0.7)", ...style }}
      aria-hidden
    />
  );
}
