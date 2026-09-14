import assert from 'node:assert/strict';
import test from 'node:test';
import { SENTIMENTS } from '../contracts/tagging';
import { classifyGenerationSchema } from '../../../ai-runtime/src/schemas/classify';
import { validatedClassifications } from '../run-service/worker-runner';
import { buildEvidencePack } from './evidence-pack';

test('500 known-label sources produce full-population emotion counts independent of sampling and tags', () => {
  const rows = Array.from({ length: 500 }, (_, i) => {
    const label = SENTIMENTS[i % SENTIMENTS.length]!;
    return { id: `item-${i}`, text: `Source ${i}: ${label}`, platform: 'csv', author: null, metrics: {}, tags: [],
      sentiment: { label, confidence: 0.9, evidence: label } };
  });
  const assignments = rows.map((row, itemIndex) => ({ itemIndex, tags: [], sentiment: row.sentiment }));
  // Production classification chunks are 50, matching the runtime contract.
  for (let start = 0; start < 500; start += 50) {
    const chunk = assignments.slice(start, start + 50).map((assignment, itemIndex) => ({ ...assignment, itemIndex }));
    assert.equal(validatedClassifications(classifyGenerationSchema.parse({ assignments: chunk }), rows.slice(start, start + 50)).length, 50);
  }
  const pack = buildEvidencePack(rows);
  assert.equal(pack.totals.sentiments.classified, 500);
  assert.equal(pack.totals.sentiments.unknown, 0);
  assert.deepEqual(pack.totals.sentiments.distribution, { excited: 72, confused: 72, complaining: 72, urging: 71, purchase_intent: 71, neutral: 71, mixed: 71 });
  assert.equal(pack.totals.taggedItems, 0);
  assert.ok(pack.topItems.length <= 64);
});

test('missing sentiment stays unknown; fabricated quotes and invalid labels never enter counts', () => {
  assert.throws(() => classifyGenerationSchema.parse({ assignments: [{ itemIndex: 0, tags: [] }] }));
  assert.equal(validatedClassifications({ assignments: [{ itemIndex: 0, tags: [] }] }, [{ text: 'legacy' }]).length, 1);
  assert.throws(() => validatedClassifications({ assignments: [{ itemIndex: 0, tags: [], sentiment: { label: 'excited', confidence: 1, evidence: 'invented' } }] }, [{ text: 'hello' }]), /invalid_sentiment_evidence/);
  const rows = [null, { label: 'neutral', confidence: 0.9, evidence: 'hello' }, { label: 'excited', confidence: 1, evidence: 'invented' }, { label: 'other', confidence: 1, evidence: 'hello' }].map((sentiment, i) => ({ id: String(i), text: 'hello', platform: 'csv', author: null, metrics: {}, tags: [], sentiment }));
  const stats = buildEvidencePack(rows).totals.sentiments;
  assert.equal(stats.classified, 1);
  assert.equal(stats.unknown, 3);
  assert.equal(stats.distribution.neutral, 1);
});
