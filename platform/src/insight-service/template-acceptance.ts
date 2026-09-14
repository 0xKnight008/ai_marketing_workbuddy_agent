import type { InsightTemplate } from '../contracts/insights';

/** Run AFTER quotation cleanup. Never pad missing outputs to meet a quota. */
export function templateAcceptanceIssues(template: InsightTemplate, report: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const requireDistinct = (key: string, min: number, max: number, field?: string) => {
    const entries = Array.isArray(report[key]) ? report[key] as unknown[] : [];
    const labels = entries.map(entry => field && entry && typeof entry === 'object'
      ? (entry as Record<string, unknown>)[field] : entry);
    const normalized = labels.map(label => typeof label === 'string' ? label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '');
    if (entries.length < min || entries.length > max || normalized.some(label => !label) || new Set(normalized).size !== entries.length) {
      issues.push(`${key}: expected ${min === max ? min : `${min}-${max}`} distinct non-empty entries`);
    }
  };
  if (template === 'content_recap') {
    requireDistinct('fanThemes', 3, 5, 'theme');
    requireDistinct('nextTopics', 10, 10);
    requireDistinct('draftTitles', 1, 10);
    requireDistinct('draftScripts', 1, 3, 'title');
  }
  if (template === 'daily_ops') requireDistinct('tasks', 3, 5, 'title');
  return issues;
}
