export const AUDIENCES = ["creators", "sellers", "community-hosts"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_TEMPLATE = {
  creators: "comment_insights",
  sellers: "review_attribution",
  "community-hosts": "community_digest",
} as const;
export function audience(value: unknown): Audience | undefined {
  return typeof value === "string" &&
    (AUDIENCES as readonly string[]).includes(value)
    ? (value as Audience)
    : undefined;
}
export function audiencePath(value: Audience, locale = "en"): string {
  return `${locale === "en" ? "" : `/${locale}`}/for/${value}/`;
}
export function audienceWorkspace(value?: Audience, locale = "en"): string {
  return `/app?locale=${locale === "zh" || locale === "es" ? locale : "en"}${value ? `&persona=${value}#start` : ""}`;
}
