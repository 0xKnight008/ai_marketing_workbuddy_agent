import type { ParsedItem } from "./csv";
/** Preserve platform, author, external ID and metrics; equal text alone is not a duplicate. */
export function uniqueImportItems(items: ParsedItem[]): ParsedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify([
      item.platform,
      item.externalId ?? "",
      item.author ?? "",
      item.text,
      Object.entries(item.metrics).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
