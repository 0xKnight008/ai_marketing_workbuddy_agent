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
  tags: string[];
}

export interface EvidencePack {
  totals: { items: number; taggedItems: number; tagDistribution: Record<string, number> };
  topItems: EvidencePackItem[];
  tagSamples: Array<{ tag: string; count: number; samples: Array<{ ref: string; snippet: string; author?: string }> }>;
  /** ref → 原始 item id，供报告引用校验与前端回链。 */
  refMap: Record<string, string>;
}

const MAX_TOP_ITEMS = 40;
const MAX_SAMPLES_PER_TAG = 8;
const MAX_TEXT_CHARS = 600;

/** 互动分：跨平台粗略可比，仅用于排序取头部内容。 */
export function engagementScore(metrics: Record<string, unknown>): number {
  const num = (key: string) => {
    const value = metrics[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return num('views') + num('likes') * 5 + num('comments') * 10 + num('shares') * 15 + num('saves') * 8 + num('rating') * 20;
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

  const sorted = [...rows].sort((a, b) => engagementScore(b.metrics) - engagementScore(a.metrics));
  const picked = sorted.slice(0, MAX_TOP_ITEMS);
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
    return {
      ref,
      platform: row.platform,
      ...(row.author ? { author: row.author } : {}),
      text,
      ...(Object.keys(metrics).length ? { metrics } : {}),
      tags: row.tags.map((tag) => tag.tag).filter((tag) => (CONTENT_TAGS as readonly string[]).includes(tag)).slice(0, 4),
    };
  });

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
      if (!ref) continue; // 未进 topItems 的条目不可被引用，跳过其样本。
      samples.push({ ref, snippet: tagEntry.evidence, ...(row.author ? { author: row.author } : {}) });
    }
    if (samples.length) tagSamples.push({ tag, count, samples });
  }

  return {
    totals: { items: rows.length, taggedItems: taggedItems.size, tagDistribution },
    topItems,
    tagSamples,
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

export type { ContentTag };
