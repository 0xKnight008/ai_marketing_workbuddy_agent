import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEvidencePack, enforceGroundedConclusions, engagementScore, validateReportCitations, type EvidenceSourceRow, type GroundingStats } from './evidence-pack';

function row(overrides: Partial<EvidenceSourceRow>): EvidenceSourceRow {
  return { id: crypto.randomUUID(), platform: 'instagram', author: null, text: 'sample text', metrics: {}, tags: [], ...overrides };
}

test('engagementScore weights interactions over raw views and ignores rating', () => {
  assert.equal(engagementScore({}), 0);
  assert.equal(engagementScore({ views: 100 }), 100);
  assert.ok(engagementScore({ likes: 10 }) > engagementScore({ views: 40 }));
  // 评分不参与互动分：高评分加分会让差评归因系统性偏向好评（审核 #4）。
  assert.equal(engagementScore({ rating: 5 }), 0);
  assert.equal(engagementScore({ rating: 1, views: 10 }), engagementScore({ rating: 5, views: 10 }));
});

test('buildEvidencePack aggregates tag distribution and assigns opaque refs', () => {
  const a = row({ text: 'where can I buy this', metrics: { views: 9000 }, tags: [{ tag: 'purchase_intent', evidence: 'where can I buy', confidence: 0.9 }] });
  const b = row({ text: 'please make merch', metrics: { views: 10 }, tags: [{ tag: 'product_demand', evidence: 'make merch', confidence: 0.8 }] });
  const c = row({ text: 'nice video', metrics: { views: 5000 } });
  const pack = buildEvidencePack([a, b, c]);

  assert.equal(pack.totals.items, 3);
  assert.equal(pack.totals.taggedItems, 2);
  assert.equal(pack.totals.tagDistribution.purchase_intent, 1);
  assert.equal(pack.totals.tagDistribution.product_demand, 1);
  // refs 是不透明短引用，不泄露内部 uuid
  assert.ok(pack.topItems.every((item) => /^i\d+$/.test(item.ref)));
  assert.ok(!JSON.stringify(pack.topItems).includes(a.id));
  assert.equal(Object.keys(pack.refMap).length, 3);
  // 互动分排序：a (9000) > c (5000) > b (10)
  assert.equal(pack.topItems[0]!.ref, 'i1');
  assert.equal(pack.refMap.i1, a.id);
  // 样本只引用进了 topItems 的条目
  const demand = pack.tagSamples.find((sample) => sample.tag === 'product_demand');
  assert.equal(demand?.count, 1);
  assert.equal(demand?.samples[0]?.snippet, 'make merch');
  assert.ok(demand?.samples[0]?.ref && pack.refMap[demand.samples[0].ref]);
});

test('buildEvidencePack skips unknown tags and truncates long texts', () => {
  const longText = `start ${'x'.repeat(2_000)} end`;
  const item = row({ text: longText, tags: [{ tag: 'not_a_tag', evidence: 'start', confidence: 0.5 }] });
  const pack = buildEvidencePack([item]);
  assert.equal(pack.totals.taggedItems, 0);
  assert.deepEqual(pack.totals.tagDistribution, {});
  assert.equal(pack.topItems[0]!.text.length, 600);
  assert.equal(pack.tagSamples.length, 0);
});

test('validateReportCitations keeps verbatim citations and drops hallucinations', () => {
  const textByRef = new Map([
    ['i1', 'I would totally buy a plushie of this character'],
    ['i2', 'the shipping took three weeks, awful'],
  ]);
  const report = {
    summary: 'Fans want merch.',
    opportunities: [
      {
        name: 'Character plushie',
        citations: [
          { ref: 'i1', snippet: 'buy a plushie of this character' }, // 逐字 → 保留
          { ref: 'i1', snippet: 'everyone loves the design' },       // 非原文 → 丢弃
          { ref: 'i99', snippet: 'unknown ref' },                    // 未知 ref → 丢弃
        ],
      },
      { name: 'Ghost entry', ref: 'i77', citations: [] },            // 未知 ref 条目 → 整条移除
    ],
  };
  const stats = { dropped: 0 };
  const cleaned = validateReportCitations(report, textByRef, stats) as typeof report;
  assert.equal(stats.dropped, 3);
  assert.equal(cleaned.opportunities.length, 1);
  assert.equal(cleaned.opportunities[0]!.citations.length, 1);
  assert.equal(cleaned.opportunities[0]!.citations[0]!.snippet, 'buy a plushie of this character');
  assert.equal(cleaned.summary, 'Fans want merch.');
});

test('validateReportCitations recurses into nested structures', () => {
  const textByRef = new Map([['i1', 'ship faster please']]);
  const report = { sections: [{ entries: [{ citations: [{ ref: 'i1', snippet: 'ship faster' }] }] }] };
  const stats = { dropped: 0 };
  const cleaned = validateReportCitations(report, textByRef, stats) as typeof report;
  assert.equal(stats.dropped, 0);
  assert.equal(cleaned.sections[0]!.entries[0]!.citations.length, 1);
});

test('buildEvidencePack computes rating distribution and carries sku', () => {
  const rows = [
    row({ text: 'broke immediately', metrics: { rating: 1, sku: 'SKU-RED' } }),
    row({ text: 'perfect fit', metrics: { rating: 5, sku: 'SKU-RED' } }),
    row({ text: 'no rating here', metrics: { views: 10 } }),
  ];
  const pack = buildEvidencePack(rows);
  assert.deepEqual(pack.totals.ratings, { rated: 2, negative: 1 });
  const withSku = pack.topItems.find((item) => item.sku === 'SKU-RED');
  assert.ok(withSku);
});

test('buildEvidencePack aggregates member stats for community digest', () => {
  const rows = [
    row({ author: 'Mod-Lin', text: 'welcome everyone', tags: [{ tag: 'co_creation', evidence: 'welcome everyone', confidence: 0.7 }] }),
    row({ author: 'Mod-Lin', text: 'happy to help', tags: [] }),
    row({ author: 'Mod-Lin', text: 'third message', tags: [] }),
    row({ author: 'Newbie', text: 'how do I join', tags: [{ tag: 'needs_reply', evidence: 'how do I join', confidence: 0.9 }] }),
    row({ text: 'anonymous message' }),
  ];
  const pack = buildEvidencePack(rows);
  assert.ok(pack.memberStats);
  assert.equal(pack.memberStats![0]!.author, 'Mod-Lin');
  assert.equal(pack.memberStats![0]!.items, 3);
  assert.ok(pack.memberStats![0]!.tags.includes('co_creation'));
  assert.equal(pack.memberStats!.find((m) => m.author === 'Newbie')?.tags[0], 'needs_reply');
});

test('buildEvidencePack keeps long-tail tag samples and negative reviews in the pack', () => {
  // 审核 #4 的复现场景：500 条高互动样本之外，1 条低互动购买意向 + 1 条低分差评。
  const rows: EvidenceSourceRow[] = [];
  for (let i = 0; i < 500; i += 1) {
    rows.push(row({ text: `great video ${i}`, metrics: { views: 10_000 - i }, tags: [{ tag: 'suggestion', evidence: `video ${i}`, confidence: 0.5 }] }));
  }
  const tail = row({ text: 'would pay for a plushie version', metrics: { views: 1 }, tags: [{ tag: 'purchase_intent', evidence: 'would pay', confidence: 0.95 }] });
  const badReview = row({ text: 'broke after one day, refund please', metrics: { views: 0, rating: 1 }, tags: [{ tag: 'complaint', evidence: 'broke after one day', confidence: 0.99 }] });
  rows.push(tail, badReview);
  const pack = buildEvidencePack(rows);

  assert.equal(pack.totals.items, 502);
  assert.equal(pack.totals.tagDistribution.purchase_intent, 1);
  assert.ok(pack.topItems.length <= 64);
  // 长尾购买意向与低分差评都进入了可引用集合。
  const tailRef = Object.entries(pack.refMap).find(([, id]) => id === tail.id)?.[0];
  const badRef = Object.entries(pack.refMap).find(([, id]) => id === badReview.id)?.[0];
  assert.ok(tailRef, 'long-tail purchase_intent item must be citable');
  assert.ok(badRef, 'low-rating negative review must be citable');
  const intent = pack.tagSamples.find((sample) => sample.tag === 'purchase_intent');
  assert.equal(intent?.samples[0]?.snippet, 'would pay');
  // 头部排序不变：互动分最高的仍排最前。
  assert.equal(pack.topItems[0]!.text, 'great video 0');
});

test('buildEvidencePack passes publishedAt through for time attribution', () => {
  const item = row({ text: 'loved the launch stream', metrics: { views: 5, publishedAt: '2026-09-01T12:00:00Z' } });
  const pack = buildEvidencePack([item]);
  assert.equal(pack.topItems[0]!.publishedAt, '2026-09-01T12:00:00Z');
});

test('enforceGroundedConclusions drops evidence-free conclusions and floors model counts', () => {
  const stats: GroundingStats = { totalConclusions: 0, groundedConclusions: 0, droppedConclusions: 0 };
  const report = {
    summary: 's',
    demandRanking: [
      { demand: 'plushie', approxCount: 1, citations: [{ ref: 'i1', snippet: 'take my money' }, { ref: 'i2', snippet: 'x' }, { ref: 'i3', snippet: 'y' }] },
      { demand: 'ghost demand', approxCount: 9, citations: [] }, // 引用被清空 → 整条移除
    ],
    highValueComments: [
      { ref: 'i1', reason: 'real anchor', replyDraft: 'thanks', citations: [] }, // ref 锚定 → 保留
    ],
  };
  const cleaned = enforceGroundedConclusions(report, stats) as typeof report;
  assert.equal(stats.totalConclusions, 3);
  assert.equal(stats.groundedConclusions, 2);
  assert.equal(stats.droppedConclusions, 1);
  assert.equal(cleaned.demandRanking.length, 1);
  // 模型自报计数不得低于可核验引用数。
  assert.equal(cleaned.demandRanking[0]!.approxCount, 3);
  assert.equal(cleaned.highValueComments.length, 1);
});

