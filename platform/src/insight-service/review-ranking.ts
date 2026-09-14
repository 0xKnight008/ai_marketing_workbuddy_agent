import type { ReviewAttributionResult } from '../contracts/insights';

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
const key = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Only call after schema validation and quotation cleanup. Severity remains a
 * model judgment; source counts are not population frequencies or sales impact. */
export function rankReviewReport(report: ReviewAttributionResult, skuByRef: Map<string, string>) {
  const sourceCount = (issue: ReviewAttributionResult['issueClusters'][number]) => new Set(issue.citations.map(c => c.ref)).size;
  const candidates = report.issueClusters.filter(issue => issue.citations.length > 0 && key(issue.theme))
    .map(issue => ({ ...issue, approxCount: sourceCount(issue),
      affectedSkus: [...new Set(issue.affectedSkus)].filter(sku => issue.citations.some(c => skuByRef.get(c.ref) === sku)),
    }))
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.approxCount - a.approxCount || (key(a.theme) < key(b.theme) ? -1 : key(a.theme) > key(b.theme) ? 1 : 0));
  const seen = new Set<string>();
  const distinct = candidates.filter(issue => { const theme = key(issue.theme); if (seen.has(theme)) return false; seen.add(theme); return true; });
  return {
    ...report,
    issueClusters: distinct.slice(0, 5),
    priorityFixes: report.priorityFixes.map((fix): ReviewAttributionResult['priorityFixes'][number] => {
      const { sku, ...rest } = fix;
      return sku && fix.citations.some(c => skuByRef.get(c.ref) === sku) ? fix : rest;
    }),
    _reviewRanking: { basis: 'model_severity_then_distinct_cited_sources', candidateIssues: report.issueClusters.length, displayedIssues: Math.min(5, distinct.length) },
  };
}
