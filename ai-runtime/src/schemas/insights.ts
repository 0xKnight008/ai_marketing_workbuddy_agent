import { z } from 'zod';

import { modelBandSchema } from './announcement';

/**
 * 迭代 2（P0 三模板）洞察报告契约。
 * 平台侧把 import_item + item_tag 聚合成确定性的「证据包」（本文件的
 * request schema），LLM 只能基于证据包生成报告，且每条结论必须引用
 * 证据包中的 ref + 原文逐字 snippet；平台侧落库前逐一硬校验。
 * 与 platform/src/contracts/insights.ts 保持双边同步。
 */

export const INSIGHT_TEMPLATES = [
  'content_recap', 'comment_insights', 'product_opportunities',
  'review_attribution', 'community_digest', 'daily_ops',
] as const;
export type InsightTemplate = (typeof INSIGHT_TEMPLATES)[number];

/** 证据包条目：ref 是平台分配的不透明短引用（i1..iN），不含租户内部 id。 */
export const evidenceItemSchema = z.object({
  ref: z.string().min(1).max(12),
  platform: z.string().max(40),
  author: z.string().max(120).optional(),
  text: z.string().min(1).max(600),
  metrics: z.record(z.string(), z.number()).optional(),
  sku: z.string().max(80).optional(),
  tags: z.array(z.string()).max(4).default([]),
});

export const tagSampleSchema = z.object({
  tag: z.string(),
  count: z.number().int().nonnegative(),
  samples: z.array(z.object({
    ref: z.string().min(1).max(12),
    snippet: z.string().min(1).max(500),
    author: z.string().max(120).optional(),
  })).max(8),
});

export const insightReportRequestSchema = z.object({
  template: z.enum(INSIGHT_TEMPLATES),
  modelBand: modelBandSchema.default('eco'),
  language: z.string().min(2).max(10).default('auto'),
  workspaceLabel: z.string().max(120).optional(),
  totals: z.object({
    items: z.number().int().nonnegative(),
    taggedItems: z.number().int().nonnegative(),
    tagDistribution: z.record(z.string(), z.number().int().nonnegative()),
    // 平台侧确定性计算的评分分布（差评归因模板用；rating ≤ 2 为差评）。
    ratings: z.object({ rated: z.number().int().nonnegative(), negative: z.number().int().nonnegative() }).optional(),
  }),
  topItems: z.array(evidenceItemSchema).max(40),
  tagSamples: z.array(tagSampleSchema).max(11),
  // 社群摘要模板的成员活跃统计（平台侧聚合，至多 20 人）。
  memberStats: z.array(z.object({
    author: z.string().max(120),
    items: z.number().int().nonnegative(),
    tags: z.array(z.string()).max(6),
  })).max(20).optional(),
  // 每日运营任务模板：近期已生成报告的摘要（洞察聚合调度器的输入）。
  priorReports: z.array(z.object({
    template: z.string(),
    title: z.string().max(120),
    summary: z.string().max(2_000),
  })).max(6).optional(),
}).strict();

/** 报告引用：ref 必须在证据包内，snippet 必须是该条原文逐字子串。 */
export const reportCitationSchema = z.object({
  ref: z.string().min(1).max(12),
  snippet: z.string().min(1).max(500),
});
export type ReportCitation = z.infer<typeof reportCitationSchema>;

const summary = z.string().min(1).max(2_000);

/** 爆款内容复盘：什么火了、为什么火、下一条怎么发。 */
export const contentRecapResultSchema = z.object({
  summary,
  topContent: z.array(z.object({
    ref: z.string().min(1).max(12),
    note: z.string().min(1).max(400),
    successFactors: z.array(z.string().max(120)).max(5),
    citations: z.array(reportCitationSchema).max(3),
  })).max(10),
  successFactors: z.array(z.object({
    factor: z.string().min(1).max(120),
    detail: z.string().min(1).max(400),
    citations: z.array(reportCitationSchema).max(3),
  })).max(8),
  fanThemes: z.array(z.object({
    theme: z.string().min(1).max(120),
    citations: z.array(reportCitationSchema).max(3),
  })).max(5),
  nextTopics: z.array(z.string().min(1).max(200)).max(10),
  draftTitles: z.array(z.string().min(1).max(200)).max(10),
});
export type ContentRecapResult = z.infer<typeof contentRecapResultSchema>;

/** 粉丝评论洞察：高频问题、情绪、需求榜、高价值评论。 */
export const commentInsightsResultSchema = z.object({
  summary,
  frequentQuestions: z.array(z.object({
    question: z.string().min(1).max(200),
    approxCount: z.number().int().nonnegative(),
    citations: z.array(reportCitationSchema).max(3),
  })).max(10),
  sentimentNotes: z.array(z.object({
    sentiment: z.enum(['excited', 'confused', 'complaining', 'urging', 'purchase_intent']),
    note: z.string().min(1).max(300),
    citations: z.array(reportCitationSchema).max(2),
  })).max(5),
  demandRanking: z.array(z.object({
    demand: z.string().min(1).max(200),
    approxCount: z.number().int().nonnegative(),
    citations: z.array(reportCitationSchema).max(3),
  })).max(10),
  productOpportunities: z.array(z.object({
    opportunity: z.string().min(1).max(200),
    citations: z.array(reportCitationSchema).max(3),
  })).max(8),
  memeMaterial: z.array(z.object({
    meme: z.string().min(1).max(200),
    citations: z.array(reportCitationSchema).max(2),
  })).max(8),
  highValueComments: z.array(z.object({
    ref: z.string().min(1).max(12),
    reason: z.string().min(1).max(300),
    replyDraft: z.string().min(1).max(600),
    citations: z.array(reportCitationSchema).max(2),
  })).max(10),
});
export type CommentInsightsResult = z.infer<typeof commentInsightsResultSchema>;

/** 商品机会发现：机会清单 + 证据 + 难度 + 验证动作 + 文案草稿。 */
export const productOpportunitiesResultSchema = z.object({
  summary,
  opportunities: z.array(z.object({
    name: z.string().min(1).max(120),
    formFactor: z.enum(['badge', 'standee', 'tshirt', 'sticker', 'blind_box', 'digital', 'course', 'membership', 'other']),
    audience: z.string().min(1).max(200),
    difficulty: z.enum(['low', 'medium', 'high']),
    evidenceCount: z.number().int().nonnegative(),
    risks: z.array(z.string().max(200)).max(4),
    validationAction: z.string().min(1).max(300),
    listingDraft: z.string().min(1).max(1_000),
    citations: z.array(reportCitationSchema).max(5),
  })).max(10),
  presalePollDraft: z.string().min(1).max(1_000),
});
export type ProductOpportunitiesResult = z.infer<typeof productOpportunitiesResultSchema>;

/** 差评归因（P1）：差评主题聚类 + SKU 维度 + 修复优先级。 */
export const reviewAttributionResultSchema = z.object({
  summary,
  issueClusters: z.array(z.object({
    theme: z.string().min(1).max(160),
    approxCount: z.number().int().nonnegative(),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    affectedSkus: z.array(z.string().max(80)).max(5),
    citations: z.array(reportCitationSchema).max(3),
  })).max(8),
  returnReasons: z.array(z.object({
    reason: z.string().min(1).max(200),
    approxCount: z.number().int().nonnegative(),
    citations: z.array(reportCitationSchema).max(3),
  })).max(6),
  expectationMismatches: z.array(z.object({
    aspect: z.string().min(1).max(120),
    detail: z.string().min(1).max(300),
    citations: z.array(reportCitationSchema).max(2),
  })).max(6),
  priorityFixes: z.array(z.object({
    fix: z.string().min(1).max(300),
    sku: z.string().max(80).optional(),
    priority: z.enum(['urgent', 'high', 'normal']),
    expectedImpact: z.string().min(1).max(200),
    citations: z.array(reportCitationSchema).max(2),
  })).max(6),
  serviceReplyDrafts: z.array(z.object({
    ref: z.string().min(1).max(12),
    issue: z.string().min(1).max(200),
    replyDraft: z.string().min(1).max(600),
    citations: z.array(reportCitationSchema).max(2),
  })).max(8),
  listingFixSuggestions: z.array(z.string().min(1).max(300)).max(8),
});
export type ReviewAttributionResult = z.infer<typeof reviewAttributionResultSchema>;

/** 社群摘要（P1）：热点 + 未解决问题 + 高价值成员 + 风险。 */
export const communityDigestResultSchema = z.object({
  summary,
  hotTopics: z.array(z.object({
    topic: z.string().min(1).max(200),
    citations: z.array(reportCitationSchema).max(3),
  })).max(8),
  unresolvedQuestions: z.array(z.object({
    question: z.string().min(1).max(200),
    citations: z.array(reportCitationSchema).max(2),
  })).max(8),
  highValueMembers: z.array(z.object({
    author: z.string().min(1).max(120),
    reason: z.string().min(1).max(300),
    signals: z.array(z.string().max(120)).max(4),
  })).max(10),
  conflictRisks: z.array(z.object({
    risk: z.string().min(1).max(200),
    severity: z.enum(['low', 'medium', 'high']),
    citations: z.array(reportCitationSchema).max(2),
  })).max(5),
  activityIdeas: z.array(z.string().min(1).max(200)).max(6),
  announcementDraft: z.string().min(1).max(1_000),
});
export type CommunityDigestResult = z.infer<typeof communityDigestResultSchema>;

/** 每日运营任务（P1）：洞察聚合 → 今日 3-5 个最重要任务。 */
export const dailyOpsResultSchema = z.object({
  summary,
  tasks: z.array(z.object({
    title: z.string().min(1).max(160),
    reason: z.string().min(1).max(300),
    suggestedAction: z.string().min(1).max(300),
    draftCopy: z.string().max(600).optional(),
    priority: z.enum(['urgent', 'high', 'normal']),
    dueHint: z.string().min(1).max(60),
    citations: z.array(reportCitationSchema).max(3),
  })).min(1).max(5),
});
export type DailyOpsResult = z.infer<typeof dailyOpsResultSchema>;

export const insightResultSchemas = {
  content_recap: contentRecapResultSchema,
  comment_insights: commentInsightsResultSchema,
  product_opportunities: productOpportunitiesResultSchema,
  review_attribution: reviewAttributionResultSchema,
  community_digest: communityDigestResultSchema,
  daily_ops: dailyOpsResultSchema,
} as const;

export type InsightReportRequest = z.infer<typeof insightReportRequestSchema>;
