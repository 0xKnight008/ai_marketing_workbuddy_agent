import { z } from 'zod';

/**
 * Unified tag taxonomy (文档 §四.2 全模板统一标签 ∪ §2 评论洞察内置标签).
 * Every V1.0 template reads and writes this same vocabulary so insights
 * aggregate across imports instead of fragmenting per template.
 */
export const CONTENT_TAGS = [
  'purchase_intent',   // 购买意向
  'product_demand',    // 商品需求
  'complaint',         // 抱怨 / 差评
  'suggestion',        // 建议
  'content_idea',      // 内容选题
  'urging_update',     // 催更
  'co_creation',       // 共创意愿
  'koc_kol_lead',      // KOC / KOL 线索（含高价值用户信号）
  'meme_material',     // 梗 / 二创素材
  'risk_event',        // 风险事件
  'needs_reply',       // 待回复
] as const;

export type ContentTag = (typeof CONTENT_TAGS)[number];

export const TAG_LABELS: Record<ContentTag, { en: string; zh: string }> = {
  purchase_intent: { en: 'Purchase intent', zh: '购买意向' },
  product_demand: { en: 'Product demand', zh: '商品需求' },
  complaint: { en: 'Complaint', zh: '抱怨/差评' },
  suggestion: { en: 'Suggestion', zh: '建议' },
  content_idea: { en: 'Content idea', zh: '内容选题' },
  urging_update: { en: 'Urging update', zh: '催更' },
  co_creation: { en: 'Co-creation', zh: '共创意愿' },
  koc_kol_lead: { en: 'KOC/KOL lead', zh: 'KOC/KOL 线索' },
  meme_material: { en: 'Meme material', zh: '梗/二创素材' },
  risk_event: { en: 'Risk event', zh: '风险事件' },
  needs_reply: { en: 'Needs reply', zh: '待回复' },
};

export const contentTagSchema = z.enum(CONTENT_TAGS);
export const modelBandSchema = z.enum(['eco', 'standard', 'flagship']);
export type ModelBandChoice = z.infer<typeof modelBandSchema>;

/**
 * 证据引用契约：AI 打标必须给出原文逐字摘录。平台侧落库前会校验
 * evidence 确为 item 文本的子串，校验不过的 tag 一律丢弃——
 * 没有证据的 AI 结论不允许进入系统（文档 §四.3）。
 */
export const tagAssignmentSchema = z.object({
  itemIndex: z.number().int().nonnegative(),
  tags: z.array(z.object({
    tag: contentTagSchema,
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(500),
  })).max(4),
});

export const classifyResultSchema = z.object({
  assignments: z.array(tagAssignmentSchema).max(200),
});

export type TagAssignment = z.infer<typeof tagAssignmentSchema>;
export type ClassifyResult = z.infer<typeof classifyResultSchema>;

/** Report-level citation shape that V1.0 templates must use when quoting users. */
export const evidenceCitationSchema = z.object({
  itemId: z.string().uuid(),
  tag: contentTagSchema,
  snippet: z.string().min(1).max(500),
  count: z.number().int().positive().optional(),
});

export type EvidenceCitation = z.infer<typeof evidenceCitationSchema>;
