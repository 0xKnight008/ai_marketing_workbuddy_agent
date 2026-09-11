import { z } from 'zod';

import { INSIGHT_TEMPLATE_LABELS, type InsightTemplate } from '../contracts/insights';

/**
 * 报告外发（迭代 4）：把已生成的洞察报告渲染成纯文本摘要，经 Resend 发邮箱，
 * 或由 worker 走 Zernio 发 Discord。摘要是给人读的速览版 —— 完整报告（含逐字
 * 证据引用）仍在 dashboard 里。摘要中不得引入报告之外的新事实。
 */

export interface ReportEmailConfig {
  apiKey: string;
  from: string;
}

interface DigestInput {
  template: InsightTemplate;
  title: string;
  itemCount: number;
  droppedCitations: number;
  report: Record<string, unknown>;
}

const text = (value: unknown, max = 300): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const bullet = (label: unknown, detail?: unknown): string | null => {
  const head = text(label, 200);
  if (!head) return null;
  const tail = text(detail, 220);
  return tail ? `• ${head} — ${tail}` : `• ${head}`;
};

/** 按模板抽取 3-5 条「要点」，字段名与 insightResultSchemas 对齐。 */
function highlights(template: InsightTemplate, report: Record<string, unknown>): string[] {
  const pick = (key: string) => (Array.isArray(report[key]) ? report[key] as Record<string, unknown>[] : []);
  switch (template) {
    case 'content_recap':
      return [
        ...pick('successFactors').slice(0, 3).map((item) => bullet(item.factor, item.detail)),
        ...pick('nextTopics').slice(0, 2).map((item) => bullet(`选题建议: ${String(item ?? '')}`)),
      ].filter((line): line is string => Boolean(line));
    case 'comment_insights':
      return [
        ...pick('frequentQuestions').slice(0, 3).map((item) => bullet(text(item.question), `约 ${Number(item.approxCount ?? 0)} 次提及`)),
        ...pick('demandRanking').slice(0, 2).map((item) => bullet(`需求: ${text(item.demand) ?? ''}`)),
      ].filter((line): line is string => Boolean(line));
    case 'product_opportunities':
      return [
        ...pick('opportunities').slice(0, 3).map((item) => bullet(text(item.name), item.validationAction)),
        ...[text(report.presalePollDraft)].filter((line): line is string => Boolean(line)).map((line) => `• 预售投票草稿：${line.slice(0, 120)}…`),
      ].filter((line): line is string => Boolean(line));
    case 'review_attribution':
      return [
        ...pick('issueClusters').slice(0, 3).map((item) => bullet(text(item.theme), `约 ${Number(item.approxCount ?? 0)} 条 · 严重度 ${text(item.severity) ?? '-'}`)),
        ...pick('priorityFixes').slice(0, 2).map((item) => bullet(`优先修复: ${text(item.fix) ?? ''}`, item.expectedImpact)),
      ].filter((line): line is string => Boolean(line));
    case 'community_digest':
      return [
        ...pick('hotTopics').slice(0, 3).map((item) => bullet(text(item.topic))),
        ...pick('unresolvedQuestions').slice(0, 2).map((item) => bullet(`待回复: ${text(item.question) ?? ''}`)),
      ].filter((line): line is string => Boolean(line));
    case 'daily_ops':
      return pick('tasks').slice(0, 5).map((item) => {
        const line = bullet(`[${text(item.priority, 20) ?? 'normal'}] ${text(item.title) ?? ''}`, item.suggestedAction);
        return line;
      }).filter((line): line is string => Boolean(line));
  }
}

export function renderReportDigest(input: DigestInput): string {
  const labels = INSIGHT_TEMPLATE_LABELS[input.template];
  const summary = text(input.report.summary, 1_500) ?? '（无摘要）';
  const lines = highlights(input.template, input.report);
  const evidence = [`基于 ${input.itemCount} 条导入内容，所有引用均经过平台逐字校验`];
  if (input.droppedCitations > 0) evidence.push(`${input.droppedCitations} 条不可验证的引用已被自动丢弃`);
  return [
    input.title,
    `模板：${labels.zh} (${labels.en})`,
    '',
    summary,
    '',
    ...(lines.length ? ['要点：', ...lines, ''] : []),
    '——',
    evidence.join('；') + '。',
    '完整报告（含逐字证据引用）请登录 Piggybot 查看。',
  ].join('\n');
}

/** 与 admin/email-login.ts 同一 Resend 模式：Bearer + Idempotency-Key + 10s 超时。 */
export async function sendReportEmail(
  config: ReportEmailConfig,
  message: { to: string; subject: string; text: string; idempotencyKey: string },
): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': message.idempotencyKey,
    },
    body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !z.object({ id: z.string().min(1) }).safeParse(await response.json().catch(() => ({}))).success) {
    throw new Error('email_rejected');
  }
}
