export interface Highlight {
  key: string;
  title: string;
  detail: string;
  citations: Array<{ ref: string; snippet: string }>;
}
const sections: Record<string, Array<[string, string, string?]>> = {
  comment_insights: [
    ["demandRanking", "demand"],
    ["frequentQuestions", "question"],
    ["sentimentNotes", "note"],
  ],
  review_attribution: [
    ["issueClusters", "theme"],
    ["expectationMismatches", "aspect", "detail"],
    ["priorityFixes", "fix", "expectedImpact"],
  ],
  community_digest: [
    ["hotTopics", "topic"],
    ["unresolvedQuestions", "question"],
    ["conflictRisks", "risk"],
  ],
};
/** Stable keys reference immutable server-generated findings, never client-supplied text. */
export function reportHighlights(
  template: string,
  report: Record<string, unknown> | null,
): Highlight[] {
  if (!report) return [];
  return (sections[template] ?? []).flatMap(([section, title, detail]) => {
    const entries = Array.isArray(report[section])
      ? (report[section] as unknown[])
      : [];
    return entries.flatMap((entry, index) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      if (typeof value[title] !== "string") return [];
      const citations = (
        Array.isArray(value.citations) ? value.citations : []
      ).filter((c): c is { ref: string; snippet: string } =>
        Boolean(
          c &&
            typeof c === "object" &&
            typeof c.ref === "string" &&
            typeof c.snippet === "string" &&
            c.snippet.trim(),
        ),
      );
      if (!citations.length) return [];
      return [
        {
          key: `${section}:${index}`,
          title: value[title] as string,
          detail:
            detail && typeof value[detail] === "string"
              ? (value[detail] as string)
              : "",
          citations,
        },
      ];
    });
  });
}
