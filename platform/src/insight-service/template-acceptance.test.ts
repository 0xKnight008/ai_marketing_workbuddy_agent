import assert from 'node:assert/strict';
import test from 'node:test';
import { contentRecapResultSchema } from '../contracts/insights';
import { contentRecapResultSchema as runtimeSchema } from '../../../ai-runtime/src/schemas/insights';
import { enforceGroundedConclusions, validateReportCitations } from './evidence-pack';
import { templateAcceptanceIssues } from './template-acceptance';

const citations = [{ ref: 'i1', snippet: 'show the process' }];
const recap = () => ({ summary: 'Fans ask for process videos', topContent: [], successFactors: [],
  fanThemes: ['Design', 'Materials', 'Assembly'].map(theme => ({ theme, citations })),
  nextTopics: Array.from({ length: 10 }, (_, i) => `Process episode ${i + 1}`), draftTitles: ['From sketch to finished piece'],
  draftScripts: [{ title: 'Making the first prototype', body: 'Hook: Watch a sketch become real.\nShow the steps.\nAsk what to build next.', citations }],
});

test('recap script contracts match across services and complete output passes acceptance', () => {
  assert.deepEqual(contentRecapResultSchema.parse(recap()), runtimeSchema.parse(recap()));
  assert.deepEqual(templateAcceptanceIssues('content_recap', recap()), []);
});

test('recap rejects short, duplicate and whitespace-only output without padding', () => {
  for (const patch of [
    { fanThemes: recap().fanThemes.slice(0, 2) }, { nextTopics: recap().nextTopics.slice(0, 9) },
    { nextTopics: [...recap().nextTopics.slice(0, 9), '  PROCESS   EPISODE 1  '] },
    { draftTitles: ['  '] }, { draftScripts: [] },
  ]) assert.ok(templateAcceptanceIssues('content_recap', { ...recap(), ...patch }).length > 0);
});

test('grounding cleanup can invalidate a previously complete recap', () => {
  const report = recap();
  report.fanThemes[2]!.citations = [{ ref: 'i1', snippet: 'invented quote' }];
  report.draftScripts[0]!.citations = [];
  const cleaned = enforceGroundedConclusions(validateReportCitations(contentRecapResultSchema.parse(report), new Map([['i1', 'Please show the process']]))) as Record<string, unknown>;
  const issues = templateAcceptanceIssues('content_recap', cleaned);
  assert.ok(issues.some(issue => issue.startsWith('fanThemes:')));
  assert.ok(issues.some(issue => issue.startsWith('draftScripts:')));
});

test('daily tasks require three to five distinct titles; unrelated templates retain their contract', () => {
  for (const count of [0, 1, 2, 6]) assert.ok(templateAcceptanceIssues('daily_ops', { tasks: Array.from({ length: count }, (_, i) => ({ title: `Task ${i}` })) }).length);
  for (const count of [3, 4, 5]) assert.deepEqual(templateAcceptanceIssues('daily_ops', { tasks: Array.from({ length: count }, (_, i) => ({ title: `Task ${i}` })) }), []);
  assert.ok(templateAcceptanceIssues('daily_ops', { tasks: [{ title: 'Reply' }, { title: ' reply ' }, { title: 'Review' }] }).length);
  assert.deepEqual(templateAcceptanceIssues('comment_insights', {}), []);
});
