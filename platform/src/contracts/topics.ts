import { z } from 'zod';

import { modelBandSchema } from './tagging';

/**
 * Module 2（全量主题聚类与可信计数）契约。
 *
 * 与固定标签（contracts/tagging.ts）互补：标签回答"这条反馈属于哪一类"，
 * 主题回答"用户具体在要什么、这个需求被提到了多少次"。
 *
 * 可信性设计与 item_tag 同构：
 * - 主题指派必须带原文逐字摘录（evidence），worker 落库前硬校验子串；
 * - "被提到 N 次" = item_topic 的行数，由 SQL COUNT 得出，LLM 无从编造；
 * - 核验路径：GET /api/topics/:id/items 逐条返回原文与证据。
 */

export const MAX_TOPICS_PER_RUN = 24;
export const MAX_TOPICS_PER_ITEM = 3;
/** taxonomy 提议阶段的抽样上限（发给 LLM 的样本条目数）。 */
export const TOPIC_PROPOSE_SAMPLE = 200;
/** 指派阶段每个 LLM chunk 的条目数（与 import.classify 一致）。 */
export const TOPIC_ASSIGN_CHUNK = 50;

/** taxonomy 内的稳定标识：snake_case，分块指派按 key 引用主题。 */
export const topicKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_]{1,39}$/);

export const topicTaxonomyEntrySchema = z.object({
  key: topicKeySchema,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
});
export type TopicTaxonomyEntry = z.infer<typeof topicTaxonomyEntrySchema>;

export const topicProposeResultSchema = z.object({
  topics: z.array(topicTaxonomyEntrySchema).min(1).max(MAX_TOPICS_PER_RUN),
});
export type TopicProposeResult = z.infer<typeof topicProposeResultSchema>;

export const topicAssignmentResultSchema = z.object({
  assignments: z.array(z.object({
    itemIndex: z.number().int().nonnegative(),
    topics: z.array(z.object({
      key: topicKeySchema,
      confidence: z.number().min(0).max(1),
      // 证据引用：必须是该 item 文本的逐字子串，平台侧硬校验后落库。
      evidence: z.string().trim().min(1).max(500),
    })).max(MAX_TOPICS_PER_ITEM),
  })).max(200),
});
export type TopicAssignmentResult = z.infer<typeof topicAssignmentResultSchema>;

export const createTopicRunSchema = z.object({
  modelBand: modelBandSchema.default('eco'),
}).strict();

export const TOPIC_RUN_STATUSES = ['pending', 'proposing', 'assigning', 'completed', 'failed'] as const;
export const topicRunStatusSchema = z.enum(TOPIC_RUN_STATUSES);
export type TopicRunStatus = z.infer<typeof topicRunStatusSchema>;

export interface TopicRunView {
  id: string;
  status: TopicRunStatus;
  modelBand: string;
  itemCount: number;
  topicCount: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TopicView {
  id: string;
  runId: string;
  key: string;
  label: string;
  description: string;
  /** 平台侧 SQL COUNT 回填的确定计数。 */
  itemCount: number;
}

export interface TopicItemView {
  itemId: string;
  platform: string;
  author: string | null;
  text: string;
  /** 逐字证据（item 文本的子串），前端高亮展示。 */
  evidence: string;
  confidence: number;
  createdAt: string;
}

export interface TopicListView {
  run: TopicRunView | null;
  topics: TopicView[];
}

export interface TopicItemListView {
  topic: TopicView;
  /** 该主题被指派的条目总数（SQL COUNT，核验口径）。 */
  total: number;
  items: TopicItemView[];
}
