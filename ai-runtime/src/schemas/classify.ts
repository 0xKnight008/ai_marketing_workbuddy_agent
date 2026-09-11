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
  language: z.string().min(2).max(10).default('auto'),
}).strict();

export const tagAssignmentSchema = z.object({
  itemIndex: z.number().int().nonnegative(),
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

export type ClassifyRequest = z.infer<typeof classifyRequestSchema>;
export type ClassifyResult = z.infer<typeof classifyResultSchema>;
