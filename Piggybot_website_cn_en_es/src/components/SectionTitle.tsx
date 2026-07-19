import React from "react";
import { Reveal } from "./Reveal";
import { StarSparkle } from "./ghibli/Piggy";

/** 统一的章节标题：小徽章 + 大标题 + 副标题 */
export function SectionTitle({
  badge,
  title,
  subtitle,
  align = "center",
  dark = false,
}: {
  badge: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: "center" | "left";
  dark?: boolean;
}) {
  const alignCls = align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <Reveal className={`max-w-3xl ${alignCls}`}>
      <span
        className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-bold sketch wobble font-display ${
          dark ? "bg-[#2C3E67] text-[#F6E7C1]" : "bg-paper-card text-ink shadow-paint-sm"
        }`}
      >
        <StarSparkle className="w-3.5 h-3.5 text-sun" />
        {badge}
      </span>
      <h2
        className={`mt-5 font-display text-3xl sm:text-4xl lg:text-[2.75rem] leading-snug ${
          dark ? "text-[#FDF6E4]" : "text-ink"
        }`}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={`mt-4 text-base sm:text-lg leading-relaxed ${dark ? "text-[#C8CFDF]" : "text-ink-soft"}`}>
          {subtitle}
        </p>
      )}
    </Reveal>
  );
}
