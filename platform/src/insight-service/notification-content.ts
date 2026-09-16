import { INSIGHT_TEMPLATE_LABELS, type InsightTemplate } from '../contracts/insights';

/**
 * Module 4 (定时运营交付闭环): deterministic content for scheduled
 * notifications. Everything rendered here is derived from platform-validated
 * report JSON or feedback rows — never new model output — and urgent risks
 * carry the same verbatim citations the report was saved with.
 */

const text = (value: unknown, max = 300): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

export interface UrgentRisk {
  source: 'conflict_risk' | 'issue_cluster';
  title: string;
  severity: 'critical' | 'high';
  citations: Array<{ ref: string; snippet: string }>;
}

/** High-severity risks, verbatim citations included; empty means no alert. */
export function detectUrgentRisks(template: InsightTemplate, report: Record<string, unknown>): UrgentRisk[] {
  const risks: UrgentRisk[] = [];
  const citationsOf = (item: Record<string, unknown>) =>
    (Array.isArray(item.citations) ? item.citations : []).flatMap(citation => {
      if (!citation || typeof citation !== 'object') return [];
      const record = citation as Record<string, unknown>;
      const ref = text(record.ref, 40);
      const snippet = text(record.snippet, 300);
      return ref && snippet ? [{ ref, snippet }] : [];
    });
  if (template === 'community_digest') {
    for (const item of Array.isArray(report.conflictRisks) ? report.conflictRisks as Record<string, unknown>[] : []) {
      if (item.severity !== 'high') continue;
      const title = text(item.risk, 200);
      if (title) risks.push({ source: 'conflict_risk', title, severity: 'high', citations: citationsOf(item) });
    }
  }
  if (template === 'review_attribution') {
    for (const item of Array.isArray(report.issueClusters) ? report.issueClusters as Record<string, unknown>[] : []) {
      if (item.severity !== 'critical' && item.severity !== 'high') continue;
      const title = text(item.theme, 160);
      if (title) risks.push({ source: 'issue_cluster', title, severity: item.severity, citations: citationsOf(item) });
    }
  }
  return risks.slice(0, 5);
}

export function renderUrgentAlert(input: { reportTitle: string; template: InsightTemplate; risks: UrgentRisk[] }): string {
  const label = INSIGHT_TEMPLATE_LABELS[input.template].en;
  const lines = input.risks.map(risk => {
    const quotes = risk.citations.slice(0, 2).map(citation => `  “${citation.snippet}”`).join('\n');
    return `• [${risk.severity.toUpperCase()}] ${risk.title}${quotes ? `\n${quotes}` : ''}`;
  });
  return [
    `Urgent risk detected in your ${label} report "${input.reportTitle}".`,
    '',
    ...lines,
    '',
    'Open the console to review the evidence and acknowledge or resolve this alert. Suggested outbound actions still require your explicit approval.',
  ].join('\n').slice(0, 12000);
}

export interface RecapInput {
  date: string; // YYYY-MM-DD (UTC)
  completed: Array<{ title: string; effect: string }>;
  planned: number;
  dismissed: number;
  unreviewedTasks: number;
}

export function renderEveningRecap(input: RecapInput): string {
  const lines = [
    `Evening recap for ${input.date} (UTC)`,
    '',
    `Completed today: ${input.completed.length}`,
    ...input.completed.slice(0, 8).map(action => `• ${text(action.title, 200)} — effect: ${action.effect}`),
    `Planned: ${input.planned} · Dismissed: ${input.dismissed}`,
  ];
  if (input.unreviewedTasks > 0) lines.push('', `${input.unreviewedTasks} suggestion(s) from today's tasks are still unreviewed — a quick decision keeps tomorrow's plan accurate.`);
  if (input.completed.length === 0 && input.planned === 0 && input.dismissed === 0) lines.push('', 'No decisions were recorded today.');
  return lines.join('\n').slice(0, 12000);
}

export function renderWeeklyReady(input: { title: string; template: InsightTemplate }): { subject: string; content: string } {
  const label = INSIGHT_TEMPLATE_LABELS[input.template].en;
  return {
    subject: `[Piggybot] Weekly ${label} report ready for approval`.slice(0, 200),
    content: [
      `Your weekly ${label} report "${input.title}" has been generated and validated.`,
      '',
      'It is waiting in the console under Notifications. Review it there and approve delivery to receive the full digest on this channel.',
    ].join('\n'),
  };
}
