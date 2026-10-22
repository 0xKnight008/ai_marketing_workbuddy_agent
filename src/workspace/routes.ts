export type Section =
  | "start"
  | "review"
  | "reports"
  | "pipelines"
  | "accounts"
  | "activity"
  | "settings";
export const sections: Section[] = [
  "start",
  "review",
  "reports",
  "pipelines",
  "accounts",
  "activity",
  "settings",
];
export const primarySections = sections;
/** Old bookmarks resolve into the canonical workspace instead of a second UI. */
export function sectionFromHash(hash: string): Section {
  const route = hash.replace(/^#/, "").split("/")[0];
  if (route === "insights") return hash.split("/")[1] ? "reports" : "start";
  const aliases: Record<string, Section> = {
    dashboard: "start",
    imports: "start",
    topics: "reports",
    notifications: "settings",
    billing: "settings",
  };
  return (
    aliases[route] ??
    (sections.includes(route as Section) ? (route as Section) : "start")
  );
}
