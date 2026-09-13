import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRequestSchema } from './classify';
import { insightReportRequestSchema } from './insights';

test('classify request accepts the reservation provider and defaults to primary', () => {
  const base = { items: [{ index: 0, text: 'hello' }] };
  assert.equal(classifyRequestSchema.parse(base).provider, 'primary');
  assert.equal(classifyRequestSchema.parse({ ...base, provider: 'fallback' }).provider, 'fallback');
  assert.equal(classifyRequestSchema.safeParse({ ...base, provider: 'mystery' }).success, false);
});

test('insight report request accepts the reservation provider and defaults to primary', () => {
  const base = {
    template: 'comment_insights',
    totals: { items: 1, taggedItems: 1, tagDistribution: { complaint: 1 } },
    topItems: [],
    tagSamples: [],
  };
  assert.equal(insightReportRequestSchema.parse(base).provider, 'primary');
  assert.equal(insightReportRequestSchema.parse({ ...base, provider: 'fallback' }).provider, 'fallback');
  assert.equal(insightReportRequestSchema.safeParse({ ...base, provider: 'mystery' }).success, false);
});
