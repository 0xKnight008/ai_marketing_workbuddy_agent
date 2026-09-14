import { z } from 'zod';

import { modelBandSchema } from './announcement';

/**
 * 与 platform/src/contracts/tagging.ts 保持一致的统一标签体系
 * （跨服务契约按既有惯例各持一份，演进时双边同步迁移）。
 */
export const CLASSIFY_TAGS = [
  'purchase_intent', 'product_demand', 'complaint', 'suggestion',
  'content_idea', 'urging_update', 'co_creation', 'koc_kol_lead',
  'meme_material', 'risk_event', 'needs_reply',
] as const;

export const classifyItemSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string().min(1).max(2_000),
  author: z.string().max(120).optional(),
  platform: z.string().max(40).optional(),
});

export const classifyRequestSchema = z.object({
  items: z.array(classifyItemSchema).min(1).max(50),
  modelBand: modelBandSchema.default('eco'),
  // 平台计费预订决定的供应商路由（degraded → fallback）；缺省 primary 兼容旧调用。
  provider: z.enum(['primary', 'fallback']).default('primary'),
  language: z.string().min(2).max(10).default('auto'),
}).strict();

export const SENTIMENTS = ['excited', 'confused', 'complaining', 'urging', 'purchase_intent', 'neutral', 'mixed'] as const;
export const sentimentSchema = z.object({
  label: z.enum(SENTIMENTS),
  confidence: z.number().min(0).max(1),
  evidence: z.string().trim().min(1).max(500),
});

export const tagAssignmentSchema = z.object({
  itemIndex: z.number().int().nonnegative(),
  // Optional during rolling upgrades; absence is unknown, never neutral.
  sentiment: sentimentSchema.optional(),
  tags: z.array(z.object({
    tag: z.enum(CLASSIFY_TAGS),
    confidence: z.number().min(0).max(1),
    // 证据引用：必须是该 item 文本的逐字子串，平台侧会硬校验。
    evidence: z.string().min(1).max(500),
  })).max(4),
});

export const classifyResultSchema = z.object({
  assignments: z.array(tagAssignmentSchema).max(200),
});

// New generation must include emotion for every item; readers accept legacy
// responses without it during rolling upgrades and mark them unknown.
export const classifyGenerationSchema = z.object({
  assignments: z.array(tagAssignmentSchema.extend({ sentiment: sentimentSchema })).max(200),
});

export type ClassifyRequest = z.infer<typeof classifyRequestSchema>;
export type ClassifyResult = z.infer<typeof classifyResultSchema>;
