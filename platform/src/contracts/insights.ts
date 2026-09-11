import { z } from 'zod';

import { modelBandSchema } from './tagging';

/**
 * 迭代 2（P0 三模板）洞察报告契约 —— 与 ai-runtime/src/schemas/insights.ts
 * 双边同步。报告中的每条 citations 落库前必须过 verbatim 校验。
 */

export const INSIGHT_TEMPLATES = [
  'content_recap', 'comment_insights', 'product_opportunities',
  'review_attribution', 'community_digest', 'daily_ops',
] as const;
export type InsightTemplate = (typeof INSIGHT_TEMPLATES)[number];

export const insightTemplateSchema = z.enum(INSIGHT_TEMPLATES);

export const INSIGHT_TEMPLATE_LABELS: Record<InsightTemplate, { en: string; zh: string; audience: string }> = {
  content_recap: { en: 'Content recap', zh: '爆款内容复盘', audience: 'creators' },
  comment_insights: { en: 'Comment insights', zh: '粉丝评论洞察', audience: 'creators + community' },
  product_opportunities: { en: 'Product opportunities', zh: '商品机会发现', audience: 'creators + sellers' },
  review_attribution: { en: 'Review attribution', zh: '差评归因', audience: 'sellers' },
  community_digest: { en: 'Community digest', zh: '社群摘要', audience: 'community' },
  daily_ops: { en: 'Daily ops tasks', zh: '每日运营任务', audience: 'all' },
};

export const reportCitationSchema = z.object({
  ref: z.string().min(1).max(12),
  snippet: z.string().min(1).max(500),
});
export type ReportCitation = z.infer<typeof reportCitationSchema>;

const summary = z.string().min(1).max(2_000);

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

export const createInsightReportSchema = z.object({
  template: insightTemplateSchema,
  title: z.string().trim().min(1).max(120).optional(),
  batchIds: z.array(z.string().uuid()).max(10).optional(),
  modelBand: modelBandSchema.default('eco'),
}).strict();

export type CreateInsightReportInput = z.infer<typeof createInsightReportSchema>;

export interface InsightReportView {
  id: string;
  template: InsightTemplate;
  title: string;
  status: 'pending' | 'generating' | 'generated' | 'failed';
  modelBand: string;
  batchIds: string[];
  itemCount: number;
  droppedCitations: number;
  error: string | null;
  createdAt: string;
  generatedAt: string | null;
  report: Record<string, unknown> | null;
}
