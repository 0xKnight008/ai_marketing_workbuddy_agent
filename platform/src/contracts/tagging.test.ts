import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTENT_TAGS, TAG_LABELS, classifyResultSchema, contentTagSchema, evidenceCitationSchema, tagAssignmentSchema } from './tagging';

test('content tag taxonomy is the unified 11-tag vocabulary', () => {
  assert.equal(CONTENT_TAGS.length, 11);
  for (const tag of CONTENT_TAGS) {
    assert.ok(TAG_LABELS[tag].en, `missing en label for ${tag}`);
    assert.ok(TAG_LABELS[tag].zh, `missing zh label for ${tag}`);
    assert.equal(contentTagSchema.safeParse(tag).success, true);
  }
  assert.equal(contentTagSchema.safeParse('made_up_tag').success, false);
});

test('tag assignments cap at four tags and require evidence', () => {
  const valid = { itemIndex: 0, tags: [{ tag: 'purchase_intent', confidence: 0.9, evidence: 'where can I buy' }] };
  assert.equal(tagAssignmentSchema.safeParse(valid).success, true);
  assert.equal(tagAssignmentSchema.safeParse({ itemIndex: 0, tags: [{ tag: 'purchase_intent', confidence: 0.9, evidence: '' }] }).success, false);
  assert.equal(tagAssignmentSchema.safeParse({ itemIndex: 0, tags: [{ tag: 'purchase_intent', confidence: 1.2, evidence: 'x' }] }).success, false);
  const fiveTags = { itemIndex: 0, tags: Array.from({ length: 5 }, () => ({ tag: 'complaint', confidence: 0.5, evidence: 'bad' })) };
  assert.equal(tagAssignmentSchema.safeParse(fiveTags).success, false);
});

test('classify result allows zero-tag assignments and caps batch size', () => {
  assert.equal(classifyResultSchema.safeParse({ assignments: [{ itemIndex: 3, tags: [] }] }).success, true);
  const oversized = { assignments: Array.from({ length: 201 }, (_, index) => ({ itemIndex: index, tags: [] })) };
  assert.equal(classifyResultSchema.safeParse(oversized).success, false);
});

test('evidence citation schema enforces verbatim snippet bounds', () => {
  const citation = { itemId: crypto.randomUUID(), tag: 'complaint', snippet: 'broke after one day' };
  assert.equal(evidenceCitationSchema.safeParse(citation).success, true);
  assert.equal(evidenceCitationSchema.safeParse({ ...citation, snippet: '' }).success, false);
  assert.equal(evidenceCitationSchema.safeParse({ ...citation, snippet: 'x'.repeat(501) }).success, false);
});
