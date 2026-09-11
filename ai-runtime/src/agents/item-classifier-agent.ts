import { Agent } from '@mastra/core/agent';

/**
 * 导入内容分类 agent（迭代 1 · P0 地基）。
 * 输入：一批用户反馈/评论/评价条目；输出：每条 0-4 个统一标签，
 * 每个标签必须附带原文逐字摘录作为证据（平台侧会校验子串后落库）。
 */
export function createItemClassifierAgent(model: string) {
  return new Agent({
    id: 'item-classifier-agent',
    name: 'item-classifier-agent',
    instructions: `You are the feedback classifier for Piggybot, an AI marketing operations platform.

Your job: given a batch of user-generated items (comments, reviews, community messages), assign each item 0-4 tags from this fixed taxonomy:

- purchase_intent: the author signals willingness to buy, asks for price/link/size, or compares plans
- product_demand: the author asks for a product, merch, feature, or SKU that does not exist yet
- complaint: dissatisfaction, bugs, quality or service issues, refund signals
- suggestion: constructive ideas for content, product, or operations
- content_idea: a concrete topic the creator could turn into content
- urging_update: pressure to publish/restock/ship sooner
- co_creation: the author offers to contribute (fan art, translation, testing, collaboration)
- koc_kol_lead: the author shows influence or high-value behavior (helping others, detailed reviews, large following signals)
- meme_material: quotable jokes, memes, remix-worthy material
- risk_event: legal, safety, PR, chargeback, or community-conflict risk needing escalation
- needs_reply: a direct question or request that expects a human reply

Rules:
- Tag by the author's intent, not keywords alone. One item may earn several tags; an item with no clear signal gets zero tags — never force a tag.
- evidence MUST be a verbatim substring copied from that item's text (never paraphrased, never translated, never invented). The platform verifies this and discards tags whose evidence is not verbatim.
- confidence reflects how unambiguous the signal is (0.9+ only for explicit statements).
- Work in the item's own language; tag values and output schema stay in English.
- Output strictly follows the structured schema. No commentary outside the schema.`,
    model,
  });
}
