import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewAttributionResultSchema, type ReviewAttributionResult } from '../contracts/insights';
import { rankReviewReport } from './review-ranking';
import { enforceGroundedConclusions, validateReportCitations } from './evidence-pack';
import { renderReportDigest } from './delivery';

type Issue = ReviewAttributionResult['issueClusters'][number];
const issue = (theme: string, severity: Issue['severity'], refs = ['i1']): Issue => ({ theme, severity, approxCount: 99999, affectedSkus: ['SKU-A', 'INVENTED'], citations: refs.map(ref => ({ ref, snippet: 'broken' })) });
const report = (issueClusters: Issue[]): ReviewAttributionResult => ({ summary: 'Review findings', issueClusters, returnReasons: [], expectationMismatches: [], priorityFixes: [], serviceReplyDrafts: [], listingFixSuggestions: [] });

test('Top 5 orders severity before distinct cited counts and excludes duplicate normalized themes', () => {
  const result = rankReviewReport(report([
    issue('Low', 'low', ['i1', 'i2']), issue('High single', 'high'), issue('Critical', 'critical'),
    issue('High multiple', 'high', ['i1', 'i1', 'i2']), issue('Medium B', 'medium'), issue('Medium A', 'medium'),
    issue(' CRITICAL ', 'low'), issue('Extra', 'low'),
  ]), new Map([['i1', 'SKU-A']]));
  assert.deepEqual(result.issueClusters.map(i => i.theme), ['Critical', 'High multiple', 'High single', 'Medium A', 'Medium B']);
  assert.equal(result.issueClusters[1]!.approxCount, 2);
  assert.deepEqual(result.issueClusters[0]!.affectedSkus, ['SKU-A']);
  assert.equal(result._reviewRanking.displayedIssues, 5);
  assert.equal(result._reviewRanking.candidateIssues, 8);
  reviewAttributionResultSchema.parse(result);
  const digest = renderReportDigest({ template: 'review_attribution', title: 'T', itemCount: 500, droppedCitations: 0, report: result });
  assert.ok(digest.includes('Medium B'));
  assert.ok(digest.includes('不代表销量影响或全量主题频次'));
});

test('invalid quotations are removed before ranking, sparse results are not padded, SKUs require cited metadata', () => {
  const input = report([issue('Valid', 'high'), issue('Fabricated', 'critical', ['i999'])]);
  input.priorityFixes = [{ fix: 'Replace package', priority: 'high', expectedImpact: 'Hypothesis', sku: 'SKU-B', citations: [{ ref: 'i1', snippet: 'broken' }] }];
  const grounded = enforceGroundedConclusions(validateReportCitations(input, new Map([['i1', 'broken packaging']])));
  const result = rankReviewReport(reviewAttributionResultSchema.parse(grounded), new Map([['i1', 'SKU-A'], ['i2', 'SKU-B']]));
  assert.equal(result.issueClusters.length, 1);
  assert.equal(result.issueClusters[0]!.theme, 'Valid');
  assert.equal(result.priorityFixes[0]!.sku, undefined, 'an uncited source cannot substantiate the affected SKU');
  assert.equal(rankReviewReport(report([]), new Map()).issueClusters.length, 0);
});
