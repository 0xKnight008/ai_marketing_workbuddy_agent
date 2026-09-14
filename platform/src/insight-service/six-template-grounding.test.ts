import assert from 'node:assert/strict';
import test from 'node:test';
import { insightResultSchemas } from '../contracts/insights';
import { buildEvidencePack, enforceGroundedConclusions, validateReportCitations } from './evidence-pack';

test('six result schemas enforce quote provenance on a 500-item deterministic evidence fixture', () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({
    id: String(i), platform: 'discord', author: 'Reader', text: 'Please make stickers', metrics: {},
    tags: [{ tag: 'product_demand', confidence: 1, evidence: 'make stickers' }],
  }));
  const pack = buildEvidencePack(rows);
  assert.equal(pack.totals.items, 500);
  assert.equal(pack.totals.taggedItems, 500);
  const texts = new Map(pack.topItems.map(item => [item.ref, item.text]));
  const citations = [{ ref: 'i1', snippet: 'make stickers' }];
  const fixtures = {
    content_recap: { summary: 'Summary', topContent: [{ ref: 'i1', note: 'Stickers', successFactors: [], citations }], successFactors: [], fanThemes: [], nextTopics: [], draftTitles: [] },
    comment_insights: { summary: 'Summary', frequentQuestions: [], sentimentNotes: [], demandRanking: [{ demand: 'Stickers', approxCount: 999999, citations }], productOpportunities: [], memeMaterial: [], highValueComments: [] },
    product_opportunities: { summary: 'Summary', opportunities: [{ name: 'Stickers', formFactor: 'sticker', audience: 'Readers', difficulty: 'low', evidenceCount: 999999, risks: [], validationAction: 'Poll', listingDraft: 'Draft', citations }], presalePollDraft: 'Poll' },
    review_attribution: { summary: 'Summary', issueClusters: [{ theme: 'Stickers', approxCount: 999999, severity: 'low', affectedSkus: [], citations }], returnReasons: [], expectationMismatches: [], priorityFixes: [], serviceReplyDrafts: [], listingFixSuggestions: [] },
    community_digest: { summary: 'Summary', hotTopics: [{ topic: 'Stickers', citations }], unresolvedQuestions: [], highValueMembers: [], conflictRisks: [], activityIdeas: [], announcementDraft: 'Draft' },
    daily_ops: { summary: 'Summary', tasks: [{ title: 'Poll', reason: 'Stickers requested', suggestedAction: 'Draft poll', priority: 'normal', dueHint: 'Today', citations }] },
  };
  for (const template of Object.keys(fixtures) as Array<keyof typeof fixtures>) {
    const schema = insightResultSchemas[template];
    const parsed = schema.parse(fixtures[template]);
    const stats = { totalConclusions: 0, groundedConclusions: 0, droppedConclusions: 0 };
    const clean = enforceGroundedConclusions(validateReportCitations(parsed, texts), stats);
    assert.equal(schema.safeParse(clean).success, true, template);
    assert.equal(stats.groundedConclusions, 1, template);
    assert.ok(!JSON.stringify(clean).includes('999999'), template);
    const fabricated = JSON.parse(JSON.stringify(parsed).replaceAll('"snippet":"make stickers"', '"snippet":"fabricated"'));
    const bad = { totalConclusions: 0, groundedConclusions: 0, droppedConclusions: 0 };
    enforceGroundedConclusions(validateReportCitations(fabricated, texts), bad);
    assert.equal(bad.groundedConclusions, 0, template);
  }
});
