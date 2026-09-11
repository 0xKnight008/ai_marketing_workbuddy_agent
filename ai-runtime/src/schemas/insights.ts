import { z } from 'zod';

import { modelBandSchema } from './announcement';

/**
 * 迭代 2（P0 三模板）洞察报告契约。
 * 平台侧把 import_item + item_tag 聚合成确定性的「证据包」（本文件的
 * request schema），LLM 只能基于证据包生成报告，且每条结论必须引用
 * 证据包中的 ref + 原文逐字 snippet；平台侧落库前逐一硬校验。
 * 与 platform/src/contracts/insights.ts 保持双边同步。
 */

export const INSIGHT_TEMPLATES = ['content_recap', 'comment_insights', 'product_opportunities'] as const;
export type InsightTemplate = (typeof INSIGHT_TEMPLATES)[number];

/** 证据包条目：ref 是平台分配的不透明短引用（i1..iN），不含租户内部 id。 */
export const evidenceItemSchema = z.object({
  ref: z.string().min(1).max(12),
  platform: z.string().max(40),
  author: z.string().max(120).optional(),
  text: z.string().min(1).max(600),
  metrics: z.record(z.string(), z.number()).optional(),
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
  }),
  topItems: z.array(evidenceItemSchema).max(40),
  tagSamples: z.array(tagSampleSchema).max(11),
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

export const insightResultSchemas = {
  content_recap: contentRecapResultSchema,
  comment_insights: commentInsightsResultSchema,
  product_opportunities: productOpportunitiesResultSchema,
} as const;

export type InsightReportRequest = z.infer<typeof insightReportRequestSchema>;
