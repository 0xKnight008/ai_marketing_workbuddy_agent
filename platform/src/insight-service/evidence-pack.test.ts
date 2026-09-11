import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEvidencePack, engagementScore, validateReportCitations, type EvidenceSourceRow } from './evidence-pack';

function row(overrides: Partial<EvidenceSourceRow>): EvidenceSourceRow {
  return { id: crypto.randomUUID(), platform: 'instagram', author: null, text: 'sample text', metrics: {}, tags: [], ...overrides };
}

test('engagementScore weights interactions over raw views', () => {
  assert.equal(engagementScore({}), 0);
  assert.equal(engagementScore({ views: 100 }), 100);
  assert.ok(engagementScore({ likes: 10 }) > engagementScore({ views: 40 }));
  assert.ok(engagementScore({ rating: 5 }) > engagementScore({ views: 50 }));
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
