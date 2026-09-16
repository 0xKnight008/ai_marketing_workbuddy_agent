import { z } from 'zod';

import { modelBandSchema } from './announcement';

/**
 * 全量主题聚类契约（Module 2）。
 * 与 platform/src/contracts/topics.ts 保持同步（跨服务契约各持一份，
 * 演进时双边同步迁移 —— 与 classify 契约的既有惯例一致）。
 */

export const MAX_TOPICS_PER_RUN = 24;
export const MAX_TOPICS_PER_ITEM = 3;

const topicKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_]{1,39}$/);

const topicSampleItemSchema = z.object({
  index: z.number().int().nonnegative(),
  text: z.string().min(1).max(2_000),
  platform: z.string().max(40).optional(),
});

/** taxonomy 提议：从全量数据的抽样中归纳具体主题。 */
export const topicProposeRequestSchema = z.object({
  items: z.array(topicSampleItemSchema).min(1).max(200),
  modelBand: modelBandSchema.default('eco'),
  provider: z.enum(['primary', 'fallback']).default('primary'),
  language: z.string().min(2).max(10).default('auto'),
}).strict();

export const topicTaxonomyEntrySchema = z.object({
  key: topicKeySchema,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
});

export const topicProposeResultSchema = z.object({
  topics: z.array(topicTaxonomyEntrySchema).min(1).max(MAX_TOPICS_PER_RUN),
});

/** 指派：把一批条目映射到既有 taxonomy（0-3 个主题/条，附逐字证据）。 */
export const topicAssignRequestSchema = z.object({
  items: z.array(topicSampleItemSchema).min(1).max(50),
  taxonomy: z.array(topicTaxonomyEntrySchema).min(1).max(MAX_TOPICS_PER_RUN),
  modelBand: modelBandSchema.default('eco'),
  provider: z.enum(['primary', 'fallback']).default('primary'),
  language: z.string().min(2).max(10).default('auto'),
}).strict();

export const topicAssignResultSchema = z.object({
  assignments: z.array(z.object({
    itemIndex: z.number().int().nonnegative(),
    topics: z.array(z.object({
      key: topicKeySchema,
      confidence: z.number().min(0).max(1),
      // 逐字证据：平台侧会硬校验其为该条目文本的子串。
      evidence: z.string().trim().min(1).max(500),
    })).max(MAX_TOPICS_PER_ITEM),
  })).max(200),
});

export type TopicProposeRequest = z.infer<typeof topicProposeRequestSchema>;
export type TopicAssignRequest = z.infer<typeof topicAssignRequestSchema>;
