import { CONTENT_TAGS, type ContentTag } from '../contracts/tagging';

/**
 * 证据包构建器（迭代 2）：把 import_item + item_tag 行聚合成发给
 * ai-runtime 的确定性证据包。LLM 只能看到包内条目（不透明 ref），
 * 不能接触租户内部 id；报告引用按 ref 回查。
 */

export interface EvidenceSourceRow {
  id: string;
  platform: string;
  author: string | null;
  text: string;
  metrics: Record<string, unknown>;
  tags: Array<{ tag: string; evidence: string; confidence: number }>;
}

export interface EvidencePackItem {
  ref: string;
  platform: string;
  author?: string;
  text: string;
  metrics?: Record<string, number>;
  /** 差评归因模板依赖的 SKU 维度（导入时从 CSV sku 列捕获）。 */
  sku?: string;
  /** 发布时刻（导入时从 CSV published_at 列捕获），时间归因依赖该字段。 */
  publishedAt?: string;
  tags: string[];
}

export interface EvidencePack {
  totals: {
    items: number;
    taggedItems: number;
    tagDistribution: Record<string, number>;
    /** 平台侧确定性计算的评分分布（rating ≤ 2 计为差评），LLM 不得编造。 */
    ratings?: { rated: number; negative: number };
  };
  topItems: EvidencePackItem[];
  tagSamples: Array<{ tag: string; count: number; samples: Array<{ ref: string; snippet: string; author?: string }> }>;
  /** 社群摘要模板依赖的成员活跃统计（按发言数排序，至多 20 人）。 */
  memberStats?: Array<{ author: string; items: number; tags: string[] }>;
  /** ref → 原始 item id，供报告引用校验与前端回链。 */
  refMap: Record<string, string>;
}

// 分层采样配额（V1 审核 #4）：头部高互动 + 每标签代表 + 低分差评。
// 旧实现只取互动分前 40 条且 rating 参与加分，长尾需求与高评分偏好会
// 同时发生（低互动购买意向、低分差评都进不了证据包）。
const HEAD_COUNT = 24;
const PER_TAG_REPS = 2;
const NEGATIVE_REVIEW_COUNT = 8;
const MAX_SAMPLES_PER_TAG = 8;
const MAX_TEXT_CHARS = 600;
/** 证据包条目硬上限：24 头部 + 11 标签 × 2 + 8 差评 ≈ 54，封顶 64。 */
export const MAX_EVIDENCE_ITEMS = 64;

/** 互动分：跨平台粗略可比，仅用于排序取头部内容。评分不参与互动分 ——
 *  高评分加分会让差评归因模板系统性偏向好评。 */
export function engagementScore(metrics: Record<string, unknown>): number {
  const num = (key: string) => {
    const value = metrics[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return num('views') + num('likes') * 5 + num('comments') * 10 + num('shares') * 15 + num('saves') * 8;
}

function numericMetric(metrics: Record<string, unknown>, key: string): number | undefined {
  const value = metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildEvidencePack(rows: EvidenceSourceRow[]): EvidencePack {
  const tagDistribution: Record<string, number> = {};
  const taggedItems = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags) {
      if (!(CONTENT_TAGS as readonly string[]).includes(tag.tag)) continue;
      tagDistribution[tag.tag] = (tagDistribution[tag.tag] ?? 0) + 1;
      taggedItems.add(row.id);
    }
  }

  // 分层采样：三类来源取并集，保证长尾标签与低分差评一定可被引用。
  const indexed = rows.map((row, index) => ({ row, index, score: engagementScore(row.metrics) }));
  const byEngagement = (a: (typeof indexed)[number], b: (typeof indexed)[number]) => b.score - a.score || a.index - b.index;
  const pickedIds = new Set<string>();
  // 1) 头部高互动内容（内容复盘模板的主样本）。
  for (const entry of [...indexed].sort(byEngagement).slice(0, HEAD_COUNT)) pickedIds.add(entry.row.id);
  // 2) 每个标签置信度最高的代表 —— 哪怕全库只出现 1 次的长尾需求也入包。
  for (const tag of CONTENT_TAGS) {
    const reps = indexed
      .filter((entry) => entry.row.tags.some((t) => t.tag === tag))
      .sort((a, b) => (b.row.tags.find((t) => t.tag === tag)?.confidence ?? 0) - (a.row.tags.find((t) => t.tag === tag)?.confidence ?? 0) || byEngagement(a, b))
      .slice(0, PER_TAG_REPS);
    for (const entry of reps) pickedIds.add(entry.row.id);
  }
  // 3) 低分差评（rating ≤ 2）：按严重度优先（分数低者在前），不看互动量。
  const negatives = indexed
    .filter((entry) => { const rating = numericMetric(entry.row.metrics, 'rating'); return rating !== undefined && rating <= 2; })
    .sort((a, b) => (numericMetric(a.row.metrics, 'rating')! - numericMetric(b.row.metrics, 'rating')!) || byEngagement(a, b))
    .slice(0, NEGATIVE_REVIEW_COUNT);
  for (const entry of negatives) pickedIds.add(entry.row.id);
  // ref 按互动分顺序分配（头部内容仍排最前），总量封顶。
  const picked = indexed.filter((entry) => pickedIds.has(entry.row.id)).sort(byEngagement).slice(0, MAX_EVIDENCE_ITEMS).map((entry) => entry.row);
  const refMap: Record<string, string> = {};
  const textByRef = new Map<string, string>();
  const topItems: EvidencePackItem[] = picked.map((row, index) => {
    const ref = `i${index + 1}`;
    refMap[ref] = row.id;
    const text = row.text.slice(0, MAX_TEXT_CHARS);
    textByRef.set(ref, text);
    const metrics: Record<string, number> = {};
    for (const [key, value] of Object.entries(row.metrics)) {
      if (typeof value === 'number' && Number.isFinite(value)) metrics[key] = value;
    }
    const sku = typeof row.metrics.sku === 'string' && row.metrics.sku.trim() ? row.metrics.sku.trim().slice(0, 80) : undefined;
    const publishedAt = typeof row.metrics.publishedAt === 'string' && row.metrics.publishedAt.trim() ? row.metrics.publishedAt.trim().slice(0, 40) : undefined;
    return {
      ref,
      platform: row.platform,
      ...(row.author ? { author: row.author } : {}),
      text,
      ...(Object.keys(metrics).length ? { metrics } : {}),
      ...(sku ? { sku } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      tags: row.tags.map((tag) => tag.tag).filter((tag) => (CONTENT_TAGS as readonly string[]).includes(tag)).slice(0, 4),
    };
  });

  // 评分分布：差评归因模板的确定性指标（rating ≤ 2 计为差评）。
  let rated = 0;
  let negative = 0;
  for (const sourceRow of rows) {
    const rating = sourceRow.metrics.rating;
    if (typeof rating === 'number' && Number.isFinite(rating)) {
      rated += 1;
      if (rating <= 2) negative += 1;
    }
  }

  // 成员活跃统计：社群摘要模板的高价值成员识别依据。
  const byAuthor = new Map<string, { items: number; tags: Set<string> }>();
  for (const sourceRow of rows) {
    if (!sourceRow.author) continue;
    const entry = byAuthor.get(sourceRow.author) ?? { items: 0, tags: new Set<string>() };
    entry.items += 1;
    for (const tag of sourceRow.tags) {
      if ((CONTENT_TAGS as readonly string[]).includes(tag.tag)) entry.tags.add(tag.tag);
    }
    byAuthor.set(sourceRow.author, entry);
  }
  const memberStats = [...byAuthor.entries()]
    .sort((a, b) => b[1].items - a[1].items)
    .slice(0, 20)
    .map(([author, entry]) => ({ author, items: entry.items, tags: [...entry.tags].slice(0, 6) }));

  const refByItemId = new Map(Object.entries(refMap).map(([ref, id]) => [id, ref]));
  const tagSamples: EvidencePack['tagSamples'] = [];
  for (const tag of CONTENT_TAGS) {
    const count = tagDistribution[tag] ?? 0;
    if (!count) continue;
    const samples: Array<{ ref: string; snippet: string; author?: string }> = [];
    const candidates = rows
      .map((row) => ({ row, tagEntry: row.tags.find((entry) => entry.tag === tag) }))
      .filter((entry): entry is { row: EvidenceSourceRow; tagEntry: { tag: string; evidence: string; confidence: number } } => Boolean(entry.tagEntry))
      .sort((a, b) => b.tagEntry.confidence - a.tagEntry.confidence);
    for (const { row, tagEntry } of candidates) {
      if (samples.length >= MAX_SAMPLES_PER_TAG) break;
      const ref = refByItemId.get(row.id);
      if (!ref) continue; // 未进证据包（分层采样并集）的条目不可被引用，跳过其样本。
      samples.push({ ref, snippet: tagEntry.evidence, ...(row.author ? { author: row.author } : {}) });
    }
    if (samples.length) tagSamples.push({ tag, count, samples });
  }

  return {
    totals: {
      items: rows.length,
      taggedItems: taggedItems.size,
      tagDistribution,
      ...(rated > 0 ? { ratings: { rated, negative } } : {}),
    },
    topItems,
    tagSamples,
    ...(memberStats.length > 0 ? { memberStats } : {}),
    refMap,
  };
}

/**
 * 报告引用硬校验：递归清理 LLM 输出。
 * - 任何名为 citations 的数组：仅保留 ref 已知且 snippet 为原文逐字子串的条目；
 * - 任何带 ref 字段的非 citation 对象（如 topContent/highValueComments 条目）：
 *   ref 不在证据包内则整条移除。
 * 返回清理后的对象与被丢弃的引用计数（供审计）。
 */
export function validateReportCitations(
  node: unknown,
  textByRef: Map<string, string>,
  stats: { dropped: number } = { dropped: 0 },
): unknown {
  if (Array.isArray(node)) {
    const cleaned = node
      .map((entry) => validateReportCitations(entry, textByRef, stats))
      .filter((entry) => entry !== REMOVED);
    return cleaned;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    // citation 对象本体：{ ref, snippet } 精确形状。
    const keys = Object.keys(record);
    if (keys.length === 2 && typeof record.ref === 'string' && typeof record.snippet === 'string') {
      const text = textByRef.get(record.ref);
      if (text === undefined || !text.includes(record.snippet)) {
        stats.dropped += 1;
        return REMOVED;
      }
      return record;
    }
    // 带 ref 的业务条目：ref 必须指向证据包内条目。
    if (typeof record.ref === 'string' && !textByRef.has(record.ref)) {
      stats.dropped += 1;
      return REMOVED;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      out[key] = validateReportCitations(value, textByRef, stats);
    }
    return out;
  }
  return node;
}

const REMOVED = Symbol('removed');

export interface GroundingStats {
  /** 结论总数：所有带 citations 字段的条目（无论最终是否保留）。 */
  totalConclusions: number;
  /** Conclusions retained with at least one verified quotation. */
  groundedConclusions: number;
  /** 被移除的结论：引用在硬校验后被清空且没有 ref 锚定。 */
  droppedConclusions: number;
}

/**
 * 结论证据门槛（V1 审核 #3）：在 validateReportCitations 清掉幻觉引用之后
 * Call only after validateReportCitations. A ref alone is not a quotation.
 * Counts represent distinct cited sources, never model-estimated population
 * frequencies. Repeated excerpts from the same source count once.
 */
export function enforceGroundedConclusions(
  node: unknown,
  stats: GroundingStats = { totalConclusions: 0, groundedConclusions: 0, droppedConclusions: 0 },
): unknown {
  if (Array.isArray(node)) {
    const kept: unknown[] = [];
    for (const entry of node) {
      const cleaned = enforceGroundedConclusions(entry, stats);
      if (cleaned === REMOVED) { stats.droppedConclusions += 1; continue; }
      kept.push(cleaned);
    }
    return kept;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.citations)) {
      stats.totalConclusions += 1;
      const citations = record.citations;
      if (!citations.length) return REMOVED;
      stats.groundedConclusions += 1;
      const out: Record<string, unknown> = { ...record };
      for (const key of ['approxCount', 'evidenceCount'] as const) {
        const value = out[key];
        if (typeof value === 'number') out[key] = new Set(citations.map(c => (c as { ref: string }).ref)).size;
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      out[key] = enforceGroundedConclusions(value, stats);
    }
    return out;
  }
  return node;
}

export type { ContentTag };
