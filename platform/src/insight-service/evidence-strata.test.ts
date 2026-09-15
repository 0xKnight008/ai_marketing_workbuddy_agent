import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_TAGS, SENTIMENTS } from '../contracts/tagging';
import { INSIGHT_TEMPLATES, insightReportRequestSchema } from '../../../ai-runtime/src/schemas/insights';
import { buildEvidencePack, type EvidenceSourceRow } from './evidence-pack';

const source = (id: string, extra: Partial<EvidenceSourceRow> = {}): EvidenceSourceRow => ({
  id, platform: 'csv', author: null, text: id, tags: [], metrics: {}, ...extra,
});

test('500-source fixture preserves every disjoint stratum within the six-template request budget', () => {
  const head = Array.from({ length: 24 }, (_, i) => source(`head-${i}`, { metrics: { views: 10000 - i } }));
  const tags = CONTENT_TAGS.flatMap(tag => [0, 1].map(i => source(`${tag}-${i}`, {
    tags: [{ tag, evidence: tag, confidence: 0.9 }],
  })));
  const reviews = Array.from({ length: 8 }, (_, i) => source(`review-${i}`, { metrics: { rating: 1 } }));
  const emotions = SENTIMENTS.map(label => source(`emotion-${label}`, {
    text: `${'背景'.repeat(400)} ${label}`, // Evidence beyond the old prefix truncation.
    sentiment: { label, evidence: label, confidence: 0.99 },
  }));
  const required = [...head, ...tags, ...reviews, ...emotions];
  const rows = [...head, ...Array.from({ length: 500 - required.length }, (_, i) => source(`filler-${i}`)), ...tags, ...reviews, ...emotions];
  const pack = buildEvidencePack(rows);
  assert.equal(pack.totals.items, 500);
  assert.equal(pack.topItems.length, 61);
  assert.deepEqual(new Set(Object.values(pack.refMap)), new Set(required.map(row => row.id)));
  assert.equal(pack.totals.sentiments.classified, 7);
  assert.equal(pack.totals.sentiments.unknown, 493);
  assert.equal(pack.totals.taggedItems, 22);
  for (const label of SENTIMENTS) {
    assert.equal(pack.totals.sentiments.distribution[label], 1);
    const item = pack.topItems.find(item => item.sentiment?.label === label)!;
    assert.ok(item.text.includes(label));
    assert.ok(item.text.length <= 600);
    assert.ok(emotions.find(row => row.id === pack.refMap[item.ref])!.text.includes(item.text));
  }
  const { refMap: _internalIds, ...request } = pack;
  for (const template of INSIGHT_TEMPLATES) {
    const parsed = insightReportRequestSchema.parse({ ...request, template });
    assert.equal(parsed.topItems.filter(item => item.sentiment).length, 7);
  }
  assert.deepEqual(buildEvidencePack(rows), pack, 'selection and opaque refs must be deterministic');
});

test('invalid historical tags cannot affect counts, representatives, samples or member labels', () => {
  const invalid = [
    { tag: 'complaint', evidence: 'invented', confidence: 1 },
    { tag: 'risk_event', evidence: '', confidence: 1 },
    { tag: 'suggestion', evidence: ' ', confidence: 1 },
    { tag: 'co_creation', evidence: 'real', confidence: NaN },
    { tag: 'needs_reply', evidence: 'real', confidence: 2 },
    { tag: 'product_demand', evidence: 'real', confidence: -1 },
    { tag: 'unknown', evidence: 'real', confidence: 0.9 },
  ];
  const rows = [source('historical', { author: 'member', text: 'real quote ', tags: [
    ...invalid,
    { tag: 'purchase_intent', evidence: 'real', confidence: 0.2 },
    { tag: 'purchase_intent', evidence: 'real quote', confidence: 0.9 },
  ] })];
  const original = structuredClone(rows);
  const pack = buildEvidencePack(rows);
  assert.deepEqual(pack.totals.tagDistribution, { purchase_intent: 1 });
  assert.equal(pack.totals.taggedItems, 1);
  assert.deepEqual(pack.topItems[0]!.tags, ['purchase_intent']);
  assert.deepEqual(pack.memberStats![0]!.tags, ['purchase_intent']);
  assert.equal(pack.tagSamples.length, 1);
  assert.equal(pack.tagSamples[0]!.samples.length, 1);
  assert.equal(pack.tagSamples[0]!.samples[0]!.snippet, 'real quote');
  assert.deepEqual(rows, original, 'normalizing evidence must not mutate source rows');
});
